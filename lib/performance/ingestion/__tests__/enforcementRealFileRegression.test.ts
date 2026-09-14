import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { ingestMontecalliniBatch, ingestSingleFile } from "../importService";
import { parseBdExportCsv } from "../../../bdExportParser";
import { parseMontecalliniPmsCsv } from "../../../montecalliniPmsParser";
import { parseNationalityWorkbook } from "../../../nationalityParser";
import { MONTECALLINI_STRUCTURE_NAME } from "../../../performanceImportRouting";
import type { StructureAlias, StructureOption } from "../types";

// ============ STEP 3 — test J: regressione sui file reali gia' validati ============
//
// Regola: se l'enforcement produce un blocco su un file gia' validato come
// corretto, e' un falso positivo del guardrail/parser, non un problema del
// file - questi test DEVONO restare verdi. Copertura end-to-end tramite il
// SERVIZIO vero (ingestSingleFile/ingestMontecalliniBatch), non solo il
// parser o il runner puro (gia' verificato altrove).

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
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: "evt-x" }, error: null }) }) }),
        };
      }
      if (table === "performance_daily_snapshot" || table === "guest_nationality") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
        };
      }
      throw new Error(`from("${table}") non atteso in questo test`);
    },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    async rpc(_fn: string, params: Record<string, unknown>) {
      rpcCallCount++;
      const rows = (params.p_snapshot_rows as unknown[]) ?? (params.p_nationality_rows as unknown[]) ?? [];
      return { data: { status: "imported", event_id: `evt-${rpcCallCount}`, imported_count: rows.length, bd_import_ids: ["bd-1"] }, error: null };
    },
    __calls: () => ({ rpcCallCount }),
  };
  return fake;
}

function makeFile(name: string): File {
  return new File(["irrilevante"], name, { type: "text/csv" });
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("J. Villa Neviera BD CSV reale, valido -> nessun blocking, imported", () => {
  const REAL_DIR = path.join(process.cwd(), ".local-imports", "bd_villa_neviera_2026-09-01");
  const CSV_FILE = "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.csv";
  const available = fs.existsSync(path.join(REAL_DIR, CSV_FILE));
  const STRUCTURE_ID = "11111111-1111-1111-1111-111111111111";
  const structures: StructureOption[] = [{ id: STRUCTURE_ID, name: "Villa Neviera Wine Resort" }];
  const aliases: StructureAlias[] = [{ structureId: STRUCTURE_ID, source: "booking_designer", alias: "Villa Neviera Wine Resort" }];

  it.skipIf(!available)("365 righe, 0 errori parser -> imported, zero validation_error", async () => {
    const csvText = fs.readFileSync(path.join(REAL_DIR, CSV_FILE), "utf-8");
    const parsed = parseBdExportCsv(csvText);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rows).toHaveLength(365);

    const fakeSupabase = makeFakeSupabase({ aliases });
    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile(CSV_FILE),
      fileContent: new TextEncoder().encode(csvText).buffer,
      extractionDate: "2026-09-01",
      snapshotRows: parsed.rows,
      parseErrors: parsed.errors,
    });

    expect(outcome.status).toBe("imported");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(1);
    // I due warning noti (GR-C01-REV 23/02, GR-C02 17/07, GR-C04 x2) restano
    // presenti come diagnostica ma NON bloccano.
    expect((outcome.guardrailFindings ?? []).every((f) => f.severity !== "blocking")).toBe(true);
  });

  if (!available) {
    it.skip(`file reale non trovato in ${REAL_DIR}`, () => {});
  }
});

describe("J. Montecallini file reali (6 mesi), validi -> nessun blocking su nessun kind", () => {
  const REAL_DIR = path.join(process.cwd(), ".local-imports", "montecallini_planningforecast_maggio_ottobre_2026");
  const MONTHS = [
    "PlanningForecast (MAGG).csv",
    "PlanningForecast (GIUG).csv",
    "PlanningForecast (LUG).csv",
    "PlanningForecast (AGO).csv",
    "PlanningForecast (SETT).csv",
    "PlanningForecast (OTT).csv",
  ];
  const available = MONTHS.every((m) => fs.existsSync(path.join(REAL_DIR, m)));
  const MC_ID = "22222222-2222-2222-2222-222222222222";

  it.skipIf(!available)("tutti i 6 file insieme (stesso batch) -> ok, nessun kind in validation_error", async () => {
    const fakeSupabase = makeFakeSupabase({ aliases: [] });

    const files = MONTHS.map((name) => {
      const content = fs.readFileSync(path.join(REAL_DIR, name), "utf-8");
      const parsed = parseMontecalliniPmsCsv(content);
      expect(parsed.errors).toHaveLength(0); // gia' verificato in Step 2, riconfermato qui
      return {
        fileName: name,
        file: makeFile(name),
        content: new TextEncoder().encode(content).buffer,
        groups: (["cy", "sdly", "ly"] as const)
          .map((kind) => ({ kind, rows: parsed.rows.filter((r) => r.kind === kind) }))
          .filter((g) => g.rows.length > 0),
        parseErrors: parsed.errors,
      };
    });

    const result = await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      selectedStructureId: MC_ID,
      structures: [{ id: MC_ID, name: MONTECALLINI_STRUCTURE_NAME }],
      uploadedBy: "user-1",
      today: "2026-09-08",
      files,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    for (const { kind, outcome } of result.batches) {
      expect(outcome.status, `kind=${kind}`).toBe("imported");
    }
  });

  if (!available) {
    it.skip(`file reali non trovati in ${REAL_DIR}`, () => {});
  }
});

describe("J. Nazionalita' Palazzo De' Belli reale, valido -> nessun blocking, imported", () => {
  const REAL_DIR = path.join(process.cwd(), ".local-imports", "nationality_palazzo_debelli_2026-09-01");
  const XLS_FILE = "Ospiti per provenienza (01 Gen 2026 - 31 Dic 2026) - Palazzo De' Belli - 2026-09-01.xls";
  const available = fs.existsSync(path.join(REAL_DIR, XLS_FILE));
  const STRUCTURE_ID = "33333333-3333-3333-3333-333333333333";
  const structures: StructureOption[] = [{ id: STRUCTURE_ID, name: "Dimora De Belli" }];
  const aliases: StructureAlias[] = [{ structureId: STRUCTURE_ID, source: "booking_designer", alias: "Palazzo De' Belli" }];

  it.skipIf(!available)("220 righe, 0 errori parser -> imported, zero validation_error", async () => {
    const parsed = parseNationalityWorkbook(toArrayBuffer(fs.readFileSync(path.join(REAL_DIR, XLS_FILE))));
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rows).toHaveLength(220);

    const fakeSupabase = makeFakeSupabase({ aliases });
    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "nationality",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile(XLS_FILE),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-01",
      nationalityRows: parsed.rows,
      parseErrors: parsed.errors,
    });

    expect(outcome.status).toBe("imported");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(1);
  });

  if (!available) {
    it.skip(`file reale non trovato in ${REAL_DIR}`, () => {});
  }
});
