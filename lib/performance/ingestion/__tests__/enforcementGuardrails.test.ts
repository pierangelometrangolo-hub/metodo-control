import { describe, expect, it } from "vitest";
import { ingestMontecalliniBatch, ingestSingleFile } from "../importService";
import { MONTECALLINI_STRUCTURE_NAME } from "../../../performanceImportRouting";
import type { StructureAlias, StructureOption } from "../types";

// ============ STEP 3 — test C, D, E, F, G, H, I: enforcement guardrail ============
//
// Solo GR-C01-QTY (quantita' negativa) e GR-C06 (chiave duplicata) hanno
// severity="blocking" nel registry (lib/performance/guardrails/registry.ts,
// invariato in questo step) - bloccano davvero da ora. Tutte le altre
// (GR-C01-REV, GR-C02, GR-C03, GR-C04, GR-C05, GR-ADR-OCC01, GR-MC-REV01)
// restano severity="warning": l'import prosegue sempre.

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

function makeFakeSupabase(opts: { aliases: StructureAlias[] } = { aliases: [] }) {
  let rpcCallCount = 0;
  let uploadCallCount = 0;
  const rpcCallsParams: Record<string, unknown>[] = [];
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
            return { select: () => ({ single: async () => ({ data: { id: `evt-${importEventInserts.length}` }, error: null }) }) };
          },
        };
      }
      if (table === "performance_daily_snapshot" || table === "guest_nationality") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
        };
      }
      throw new Error(`from("${table}") non atteso in questo test`);
    },
    storage: { from: () => ({ upload: async () => { uploadCallCount++; return { error: null }; } }) },
    async rpc(_fn: string, params: Record<string, unknown>) {
      rpcCallCount++;
      rpcCallsParams.push(params);
      const rows = (params.p_snapshot_rows as unknown[]) ?? (params.p_nationality_rows as unknown[]) ?? [];
      return { data: { status: "imported", event_id: `evt-rpc-${rpcCallCount}`, imported_count: rows.length, bd_import_ids: ["bd-1"] }, error: null };
    },
    __calls: () => ({ rpcCallCount, uploadCallCount, rpcCallsParams, importEventInserts }),
  };
  return fake;
}

const STRUCTURE_ID = "11111111-1111-1111-1111-111111111111";
const structures: StructureOption[] = [{ id: STRUCTURE_ID, name: "Villa Neviera Wine Resort" }];
const aliases: StructureAlias[] = [{ structureId: STRUCTURE_ID, source: "booking_designer", alias: "Villa Neviera Wine Resort" }];
const FILE_NAME = "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.csv";
const NATIONALITY_FILE_NAME = "Ospiti per provenienza (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-08.csv";

function makeFile(name: string): File {
  return new File(["irrilevante"], name, { type: "text/csv" });
}

describe("C. quantita' negativa (GR-C01-QTY) -> validation_error, zero commit", () => {
  it("rooms_sold negativo blocca l'intero file", async () => {
    const fakeSupabase = makeFakeSupabase({ aliases });
    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile(FILE_NAME),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-01",
      snapshotRows: [
        { stayDate: "2026-01-01", revenueTotal: 100, roomsSold: -2, roomsAvailable: 10, arrivals: 1, presences: 8 },
        { stayDate: "2026-01-02", revenueTotal: 100, roomsSold: 5, roomsAvailable: 10, arrivals: 1, presences: 8 },
      ],
    });

    expect(outcome.status).toBe("validation_error");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(0);
    const insert = fakeSupabase.__calls().importEventInserts[0];
    expect(insert.error_code).toBe("negative_physical_quantity");
  });
});

describe("D. chiave duplicata ADR/RevPAR (GR-C06) -> validation_error, zero commit", () => {
  it("stesso stay_date due volte, valori diversi -> blocco totale", async () => {
    const fakeSupabase = makeFakeSupabase({ aliases });
    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile(FILE_NAME),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-01",
      snapshotRows: [
        { stayDate: "2026-01-05", revenueTotal: 100, roomsSold: 5, roomsAvailable: 10, arrivals: 1, presences: 8 },
        { stayDate: "2026-01-05", revenueTotal: 300, roomsSold: 7, roomsAvailable: 10, arrivals: 2, presences: 12 },
      ],
    });

    expect(outcome.status).toBe("validation_error");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(0);
    expect(fakeSupabase.__calls().uploadCallCount).toBe(0);
    expect(fakeSupabase.__calls().importEventInserts[0].error_code).toBe("duplicate_logical_key");
  });
});

describe("E. chiave duplicata Nazionalita' (GR-C06) -> validation_error", () => {
  it("stessa coppia (stay_date, nationality) due volte -> blocco totale, zero commit", async () => {
    const fakeSupabase = makeFakeSupabase({ aliases });
    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "nationality",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile(NATIONALITY_FILE_NAME),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-08",
      nationalityRows: [
        { stayDate: "2026-01-01", nationality: "ITALIA", presences: 3 },
        { stayDate: "2026-01-01", nationality: "ITALIA", presences: 5 },
      ],
    });

    expect(outcome.status).toBe("validation_error");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(0);
    expect(fakeSupabase.__calls().importEventInserts[0].error_code).toBe("duplicate_logical_key");
  });
});

describe("F. Montecallini: duplicato dentro CY -> SOLO CY bloccato, SDLY e LY validi proseguono", () => {
  it("CY con stay_date duplicato -> validation_error; SDLY e LY puliti -> imported, commit regolare", async () => {
    const MC_ID = "22222222-2222-2222-2222-222222222222";
    const fakeSupabase = makeFakeSupabase({ aliases: [] });

    const file = makeFile("PlanningForecast (LUG).csv");
    const result = await ingestMontecalliniBatch({
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
              kind: "cy",
              rows: [
                { stayDate: "2026-07-10", revenueTotal: 100, roomsSold: 3, roomsAvailable: 48, arrivals: null, presences: 5 },
                { stayDate: "2026-07-10", revenueTotal: 200, roomsSold: 5, roomsAvailable: 48, arrivals: null, presences: 9 },
              ],
            },
            {
              kind: "sdly",
              rows: [{ stayDate: "2025-07-10", revenueTotal: 150, roomsSold: 4, roomsAvailable: 48, arrivals: null, presences: 7 }],
            },
            {
              kind: "ly",
              rows: [{ stayDate: "2025-07-10", revenueTotal: 150, roomsSold: 4, roomsAvailable: 48, arrivals: null, presences: 7 }],
            },
          ],
        },
      ],
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");

    const cy = result.batches.find((b) => b.kind === "cy")!;
    const sdly = result.batches.find((b) => b.kind === "sdly")!;
    const ly = result.batches.find((b) => b.kind === "ly")!;

    expect(cy.outcome.status).toBe("validation_error");
    expect(sdly.outcome.status).toBe("imported");
    expect(ly.outcome.status).toBe("imported");

    // Solo 2 RPC (sdly + ly) - cy non ha mai raggiunto la RPC.
    expect(fakeSupabase.__calls().rpcCallCount).toBe(2);
  });
});

describe("G, H, I. warning restano warning - l'import prosegue sempre", () => {
  it("G. revenue negativo (GR-C01-REV) -> warning, import prosegue", async () => {
    const fakeSupabase = makeFakeSupabase({ aliases });
    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile(FILE_NAME),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-01",
      snapshotRows: [{ stayDate: "2026-02-23", revenueTotal: -119, roomsSold: 1, roomsAvailable: 9, arrivals: 0, presences: 0 }],
    });

    expect(outcome.status).toBe("imported");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(1);
    expect(new Set((outcome.guardrailFindings ?? []).map((f) => f.id)).has("GR-C01-REV")).toBe(true);
  });

  it("H. sold > available su Booking Designer (GR-C02, overbooking reale) -> warning, import prosegue", async () => {
    const fakeSupabase = makeFakeSupabase({ aliases });
    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile(FILE_NAME),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-01",
      snapshotRows: [{ stayDate: "2026-07-17", revenueTotal: 1583.63, roomsSold: 10, roomsAvailable: 9, arrivals: 8, presences: 22 }],
    });

    expect(outcome.status).toBe("imported");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(1);
    expect(new Set((outcome.guardrailFindings ?? []).map((f) => f.id)).has("GR-C02")).toBe(true);
  });

  it("I. revenue > 0 con rooms_sold = 0 (GR-C04, no-show/penale) -> warning, import prosegue", async () => {
    const fakeSupabase = makeFakeSupabase({ aliases });
    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile(FILE_NAME),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-01",
      snapshotRows: [{ stayDate: "2026-01-04", revenueTotal: 106, roomsSold: 0, roomsAvailable: 9, arrivals: 0, presences: 0 }],
    });

    expect(outcome.status).toBe("imported");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(1);
    expect(new Set((outcome.guardrailFindings ?? []).map((f) => f.id)).has("GR-C04")).toBe(true);
  });
});
