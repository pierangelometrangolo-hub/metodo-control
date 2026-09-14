import { describe, expect, it } from "vitest";
import { ingestMontecalliniBatch, ingestSingleFile } from "../importService";
import { computeSnapshotContentHash } from "../normalization";
import { GUARDRAILS_SHADOW_MODE } from "../../guardrails/runner";
import type { StructureAlias, StructureOption } from "../types";
import { MONTECALLINI_STRUCTURE_NAME } from "../../../performanceImportRouting";

// ============ Guardrails — STEP 3 enforcement, integrazione con importService ============
// Verifica che il runner giri DOPO la normalizzazione e che importService
// ORA legga davvero hasBlockingFindings: solo le findings severity="blocking"
// (GR-C06, GR-C01-QTY) bloccano (validation_error, zero RPC, zero upload);
// tutte le altre (warning/info) non bloccano MAI, esattamente come in
// shadow mode - non cambia ne' hash ne' payload RPC per gli import che
// procedono.

function fakeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => result,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function makeFakeSupabase(opts: { aliases: StructureAlias[]; rpcResult: { data?: unknown; error?: unknown } }) {
  let rpcCallCount = 0;
  let rpcParams: Record<string, unknown> | null = null;
  let uploadCallCount = 0;
  const importEventInserts: Record<string, unknown>[] = [];

  const fake = {
    from(table: string) {
      if (table === "structure_source_aliases") {
        return fakeQueryBuilder({
          data: opts.aliases.map((a) => ({ structure_id: a.structureId, source: a.source, alias: a.alias })),
          error: null,
        });
      }
      if (table === "performance_import_events") {
        return {
          select: () => fakeQueryBuilder({ data: null, error: null }),
          insert: (payload: Record<string, unknown>) => {
            importEventInserts.push(payload);
            return { select: () => ({ single: async () => ({ data: { id: "evt-x" }, error: null }) }) };
          },
        };
      }
      if (table === "performance_daily_snapshot" || table === "guest_nationality") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
        };
      }
      throw new Error(`from("${table}") non atteso`);
    },
    storage: { from: () => ({ upload: async () => { uploadCallCount++; return { error: null }; } }) },
    async rpc(_fn: string, params: Record<string, unknown>) {
      rpcCallCount++;
      rpcParams = params;
      return opts.rpcResult;
    },
    __calls: () => ({ rpcCallCount, rpcParams, uploadCallCount, importEventInserts }),
  };
  return fake;
}

const STRUCTURE_ID = "11111111-1111-1111-1111-111111111111";
const structures: StructureOption[] = [{ id: STRUCTURE_ID, name: "Villa Neviera Wine Resort" }];
const aliases: StructureAlias[] = [{ structureId: STRUCTURE_ID, source: "booking_designer", alias: "Villa Neviera Wine Resort" }];
const FILE_NAME = "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.csv";

function makeFile(content: string, name = FILE_NAME): File {
  return new File([content], name, { type: "text/csv" });
}

// Righe con SOLO anomalie warning (mai bloccanti, ne' in shadow mode ne'
// in enforcement): ricavo-senza-camere (GR-C04) e sold>available (GR-C02,
// overbooking - validato su dato reale). Nessuna quantita' negativa, nessun
// duplicato di stay_date.
const WARNING_ONLY_ROWS = [
  { stayDate: "2026-01-01", revenueTotal: 100, roomsSold: 0, roomsAvailable: 10, arrivals: 1, presences: 0 },
  { stayDate: "2026-01-02", revenueTotal: 200, roomsSold: 12, roomsAvailable: 10, arrivals: 4, presences: 20 },
];

// Righe con anomalie BLOCKING: una quantita' negativa (GR-C01-QTY) e un
// duplicato di stay_date (GR-C06).
const BLOCKING_ROWS = [
  { stayDate: "2026-01-01", revenueTotal: 100, roomsSold: -1, roomsAvailable: 10, arrivals: 1, presences: 8 },
  { stayDate: "2026-01-03", revenueTotal: 200, roomsSold: 5, roomsAvailable: 10, arrivals: 2, presences: 9 },
  { stayDate: "2026-01-03", revenueTotal: 999, roomsSold: 6, roomsAvailable: 10, arrivals: 2, presences: 9 },
];

describe("STEP 3 enforcement: warning non bloccano mai", () => {
  it("GUARDRAILS_SHADOW_MODE e' FALSE (enforcement attivo da questo step)", () => {
    expect(GUARDRAILS_SHADOW_MODE).toBe(false);
  });

  it("righe con SOLE anomalie warning -> import arriva comunque a 'imported', un solo tentativo RPC", async () => {
    const fakeSupabase = makeFakeSupabase({
      aliases,
      rpcResult: { data: { status: "imported", event_id: "evt-1", imported_count: WARNING_ONLY_ROWS.length, bd_import_ids: ["bd-1"] }, error: null },
    });

    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile("irrilevante"),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-01",
      snapshotRows: WARNING_ONLY_ROWS,
    });

    expect(outcome.status).toBe("imported");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(1);
    const ids = new Set((outcome.guardrailFindings ?? []).map((f) => f.id));
    expect(ids.has("GR-C04")).toBe(true);
    expect(ids.has("GR-C02")).toBe(true);
  });

  it("righe con anomalie BLOCKING -> validation_error, ZERO RPC, ZERO upload - le findings restano disponibili", async () => {
    const fakeSupabase = makeFakeSupabase({
      aliases,
      rpcResult: { data: { status: "imported", event_id: "evt-1", imported_count: BLOCKING_ROWS.length, bd_import_ids: ["bd-1"] }, error: null },
    });

    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile("irrilevante"),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-01",
      snapshotRows: BLOCKING_ROWS,
    });

    expect(outcome.status).toBe("validation_error");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(0);
    expect(fakeSupabase.__calls().uploadCallCount).toBe(0);

    const ids = new Set((outcome.guardrailFindings ?? []).map((f) => f.id));
    expect(ids.has("GR-C01-QTY")).toBe(true);
    expect(ids.has("GR-C06")).toBe(true);

    // Evento validation_error auditato (preflight, fuori dalla transazione RPC).
    const insert = fakeSupabase.__calls().importEventInserts[0];
    expect(insert.status).toBe("validation_error");
    expect(insert.error_code).toBe("guardrail_validation_failed"); // due guardrail blocking distinti -> codice sintetico
  });

  it("il payload RPC NON contiene mai sourceKpi (solo i 6 campi importati + source_index)", async () => {
    const fakeSupabase = makeFakeSupabase({
      aliases,
      rpcResult: { data: { status: "imported", event_id: "evt-1", imported_count: 1, bd_import_ids: ["bd-1"] }, error: null },
    });

    await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile("irrilevante"),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-01",
      snapshotRows: [
        { stayDate: "2026-05-01", revenueTotal: 500, roomsSold: 5, roomsAvailable: 10, arrivals: 2, presences: 8, sourceKpi: { occupancyFraction: 0.5, revpar: 50, adr: 100 } },
      ],
    });

    const sent = fakeSupabase.__calls().rpcParams!.p_snapshot_rows as Record<string, unknown>[];
    expect(Object.keys(sent[0]).sort()).toEqual(
      ["arrivals", "presences", "revenue_total", "rooms_available", "rooms_sold", "source_index", "stay_date"].sort()
    );
    expect(sent[0]).not.toHaveProperty("sourceKpi");
  });

  it("il normalized_content_hash NON cambia se si aggiunge/rimuove sourceKpi alle righe", async () => {
    const base = [
      { stayDate: "2026-05-01", revenueTotal: 500, roomsSold: 5, roomsAvailable: 10, arrivals: 2, presences: 8, sourceIndex: 0 },
      { stayDate: "2026-05-02", revenueTotal: 600, roomsSold: 6, roomsAvailable: 10, arrivals: 3, presences: 9, sourceIndex: 0 },
    ];
    const withKpi = base.map((r) => ({ ...r, sourceKpi: { occupancyFraction: 0.5, revpar: 50, adr: 100 } }));
    expect(await computeSnapshotContentHash(withKpi)).toBe(await computeSnapshotContentHash(base));
  });

  it("Montecallini: un kind con anomalie blocking non impedisce agli altri kind della stessa chiamata di committare", async () => {
    const MC_ID = "22222222-2222-2222-2222-222222222222";
    const fakeSupabase = makeFakeSupabase({
      aliases: [],
      rpcResult: { data: { status: "imported", event_id: "evt-mc", imported_count: 1, bd_import_ids: ["bd-1"] }, error: null },
    });

    const file = makeFile("irrilevante-pms.csv", "PlanningForecast (LUG).csv");
    const res = await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      selectedStructureId: MC_ID,
      structures: [{ id: MC_ID, name: MONTECALLINI_STRUCTURE_NAME }],
      uploadedBy: "user-1",
      today: "2026-09-08",
      files: [
        {
          fileName: file.name,
          file,
          content: new TextEncoder().encode("x").buffer,
          groups: [
            {
              // CY: stay_date duplicato -> GR-C06 blocking
              kind: "cy",
              rows: [
                { stayDate: "2026-07-10", revenueTotal: 100, roomsSold: 3, roomsAvailable: 48, arrivals: null, presences: 5 },
                { stayDate: "2026-07-10", revenueTotal: 200, roomsSold: 5, roomsAvailable: 48, arrivals: null, presences: 9 },
              ],
            },
            {
              // SDLY: pulito -> deve committare regolarmente
              kind: "sdly",
              rows: [{ stayDate: "2025-07-10", revenueTotal: 150, roomsSold: 4, roomsAvailable: 48, arrivals: null, presences: 7 }],
            },
          ],
        },
      ],
    });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");

    const cy = res.batches.find((b) => b.kind === "cy")!;
    expect(cy.outcome.status).toBe("validation_error");
    expect(new Set((cy.outcome.guardrailFindings ?? []).map((f) => f.id)).has("GR-C06")).toBe(true);

    const sdly = res.batches.find((b) => b.kind === "sdly")!;
    expect(sdly.outcome.status).toBe("imported");

    // Un solo tentativo RPC: SOLO per sdly (cy non ha mai raggiunto la RPC).
    expect(fakeSupabase.__calls().rpcCallCount).toBe(1);
  });
});
