import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { ingestMontecalliniBatch, ingestSingleFile } from "../importService";
import { parseBdExportCsv, parseBdExportWorkbook } from "../../../bdExportParser";
import { parseMontecalliniPmsCsv } from "../../../montecalliniPmsParser";
import type { StructureAlias, StructureOption } from "../types";
import { MONTECALLINI_STRUCTURE_NAME } from "../../../performanceImportRouting";

// ============ STEP 3 — test A, B, K: parser errors -> file-level block ============
//
// Principio: una VERA riga-dato non parsabile (data illeggibile, valore
// numerico obbligatorio assente, cella Revenue formato-data, colonne
// mancanti...) blocca l'INTERO file/batch - mai "riga esclusa, resto
// importato". Le righe strutturali attese (TOTALE/footer/riga vuota) non
// sono mai in errors (comportamento gia' corretto nei parser, invariato in
// questo step) e quindi non bloccano mai.

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

function makeFakeSupabase(opts: { aliases: StructureAlias[] }) {
  let rpcCallCount = 0;
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
      throw new Error(`from("${table}") non atteso in questo test`);
    },
    storage: { from: () => ({ upload: async () => { uploadCallCount++; return { error: null }; } }) },
    async rpc() {
      rpcCallCount++;
      throw new Error("RPC non doveva essere chiamata - il blocco deve avvenire PRIMA");
    },
    __calls: () => ({ rpcCallCount, uploadCallCount, importEventInserts }),
  };
  return fake;
}

const STRUCTURE_ID = "11111111-1111-1111-1111-111111111111";
const structures: StructureOption[] = [{ id: STRUCTURE_ID, name: "Villa Neviera Wine Resort" }];
const aliases: StructureAlias[] = [{ structureId: STRUCTURE_ID, source: "booking_designer", alias: "Villa Neviera Wine Resort" }];
const FILE_NAME = "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.csv";

function makeFile(name: string): File {
  return new File(["irrilevante"], name, { type: "text/csv" });
}

const BD_HEADER =
  ',Data,"Unità occupate","Unità Libere","Unità in vendita","Unità chiuse",IMO,"Indice Medio Occupazione",Arrivi,Presenze,"Revenue Totale","Tariffa media (ADR)",RevPAR,BW';

describe("A. vera riga-dato non parsabile -> validation_error, zero RPC, zero upload, zero scrittura", () => {
  it("BD CSV: una riga con Revenue non numerico (vera riga-dato) blocca l'intero file, anche con altre righe valide", async () => {
    const good1 = ',"Giovedì, 01 Gennaio 2026",5,3,8,0,"62.5 %",62%,2,10,"€ 670,33","€ 134,07","€ 83,79","26 gg"';
    const broken = ',"Venerdì, 02 Gennaio 2026",5,3,8,0,"62.5 %",62%,2,10,"non-un-numero","€ 0","€ 0","1 gg"';
    const good2 = ',"Sabato, 03 Gennaio 2026",6,3,9,0,"66.67 %",66%,4,12,"€ 882,34","€ 147,06","€ 98,04","26 gg"';
    const parsed = parseBdExportCsv([BD_HEADER, good1, broken, good2].join("\n"));

    expect(parsed.errors).toHaveLength(1); // la riga rotta
    expect(parsed.rows).toHaveLength(2); // le altre due sopravvivono nel parser

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
      snapshotRows: parsed.rows,
      parseErrors: parsed.errors,
    });

    expect(outcome.status).toBe("validation_error");
    if (outcome.status === "validation_error") {
      expect(outcome.message).toContain("2"); // 2 righe sopravvissute, comunque MAI importate
    }
    expect(fakeSupabase.__calls().rpcCallCount).toBe(0);
    expect(fakeSupabase.__calls().uploadCallCount).toBe(0);

    const insert = fakeSupabase.__calls().importEventInserts[0];
    expect(insert.status).toBe("validation_error");
    expect(insert.error_code).toBe("parser_row_error"); // righe sopravvissute > 0
  });

  it("BD CSV: colonne obbligatorie mancanti (errore strutturale, 0 righe) -> validation_error/parser_structure_error", async () => {
    const parsed = parseBdExportCsv("Data,Foo,Bar\n01/01/2026,1,2");
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors.length).toBeGreaterThan(0);

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
      snapshotRows: parsed.rows,
      parseErrors: parsed.errors,
    });

    expect(outcome.status).toBe("validation_error");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(0);
    const insert = fakeSupabase.__calls().importEventInserts[0];
    expect(insert.error_code).toBe("parser_structure_error"); // 0 righe sopravvissute
  });

  it("D. duplicate logical key ADR (stay_date) senza errori parser -> BLOCKING via guardrail, zero commit (contrasto con A: qui la causa e' GR-C06, non il parser)", async () => {
    const fakeSupabase = makeFakeSupabase({ aliases });
    const rows = [
      { stayDate: "2026-01-01", revenueTotal: 100, roomsSold: 5, roomsAvailable: 10, arrivals: 1, presences: 8 },
      { stayDate: "2026-01-01", revenueTotal: 120, roomsSold: 6, roomsAvailable: 10, arrivals: 1, presences: 9 },
    ];
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
      snapshotRows: rows,
    });

    expect(outcome.status).toBe("validation_error");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(0);
    const insert = fakeSupabase.__calls().importEventInserts[0];
    expect(insert.error_code).toBe("duplicate_logical_key");
  });
});

describe("B. righe strutturali attese (TOTALE/footer) -> MAI validation_error", () => {
  it("Montecallini: file con solo TOTALE + DISPONIBILI A FINE MESE oltre a righe valide -> nessun parseError, batch procede", async () => {
    const csv = [
      "DATA;CP;CV;PAX;RICAVI TRAT;ADR;RPAR;OCCUP",
      "01/05/2026 ven;10;48;20;1.000,00;100,00;20,83;20,8%",
      "01/05/2025 gio (SDLY);8;42;16;800,00;100,00;19,05;19,0%",
      "TOTALE CY;;;;;;;",
      "TOTALE SDLY;;;;;;;",
      "DISPONIBILI A FINE MESE;;;;;;;",
    ].join("\n");
    const parsed = parseMontecalliniPmsCsv(csv);
    expect(parsed.errors).toHaveLength(0); // righe strutturali MAI in errors
    expect(parsed.excludedRows.length).toBeGreaterThanOrEqual(3);

    const MC_ID = "22222222-2222-2222-2222-222222222222";
    const fakeSupabase = makeFakeSupabase({ aliases: [] });
    // rpc non deve lanciare qui: sovrascrivo per permettere il commit.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fakeSupabase as any).rpc = async () => ({
      data: { status: "imported", event_id: "evt-1", imported_count: 1, bd_import_ids: ["bd-1"] },
      error: null,
    });

    const cyRows = parsed.rows.filter((r) => r.kind === "cy");
    const sdlyRows = parsed.rows.filter((r) => r.kind === "sdly");

    const result = await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      selectedStructureId: MC_ID,
      structures: [{ id: MC_ID, name: MONTECALLINI_STRUCTURE_NAME }],
      uploadedBy: "user-1",
      today: "2026-09-08",
      files: [
        {
          fileName: "PlanningForecast (MAGG).csv",
          file: makeFile("PlanningForecast (MAGG).csv"),
          content: new TextEncoder().encode(csv).buffer,
          groups: [
            { kind: "cy", rows: cyRows },
            { kind: "sdly", rows: sdlyRows },
          ],
          parseErrors: parsed.errors, // vuoto - le righe strutturali non lo popolano mai
        },
      ],
    });

    expect(result.status).toBe("ok"); // MAI validation_error/routing_error per righe strutturali
  });
});

describe("K. Villa Neviera XLS reale (Revenue cella formato-data) -> validation_error, 0 commit (NON piu' 364/365)", () => {
  const REAL_DIR = path.join(process.cwd(), ".local-imports", "bd_villa_neviera_2026-09-01");
  const XLS_FILE = "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.xls";
  const available = fs.existsSync(path.join(REAL_DIR, XLS_FILE));

  function toArrayBuffer(buf: Buffer): ArrayBuffer {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  it.skipIf(!available)("365 righe totali, 364 valide + 1 scartata dal parser (27/07) -> il file INTERO viene bloccato, zero RPC", async () => {
    const parsed = parseBdExportWorkbook(toArrayBuffer(fs.readFileSync(path.join(REAL_DIR, XLS_FILE))));

    // Precondizione: il comportamento del PARSER resta invariato (scarta
    // solo la riga fisicamente corrotta, non tutto il file) - e' il
    // SERVIZIO, non il parser, a trasformare questo in un blocco totale.
    expect(parsed.rows).toHaveLength(364);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain("27 Luglio");

    const fakeSupabase = makeFakeSupabase({ aliases });
    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile(XLS_FILE),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-01",
      snapshotRows: parsed.rows, // le 364 righe "buone" - MA il file va bloccato comunque
      parseErrors: parsed.errors,
    });

    // Il vecchio comportamento (364/365 importate) NON e' piu' accettabile:
    // ora l'intero file e' validation_error, zero scritture.
    expect(outcome.status).toBe("validation_error");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(0);
    expect(fakeSupabase.__calls().uploadCallCount).toBe(0);
    if (outcome.status === "validation_error") {
      expect(outcome.message).toContain("27 Luglio");
    }
  });

  if (!available) {
    it.skip(`file reale non trovato in ${REAL_DIR} - copiarlo li' per eseguire il test K`, () => {});
  }
});
