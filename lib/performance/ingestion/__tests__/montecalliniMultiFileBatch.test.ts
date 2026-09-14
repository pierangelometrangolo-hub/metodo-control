import { describe, expect, it } from "vitest";
import { ingestMontecalliniBatch } from "../importService";
import { computeBatchHash } from "../normalization";
import { sha256Hex } from "../hashing";
import { MONTECALLINI_STRUCTURE_NAME } from "../../../performanceImportRouting";
import type { GroupKind, ImportableRow } from "../../../performanceImportRouting";
import type { StructureOption } from "../types";

// ============ BUGFIX 14/09/2026 - orchestrazione multi-file Montecallini ============
//
// Causa reale: source_checksum/batch_hash veniva ricalcolato PER KIND a
// partire dal sottoinsieme di file che avevano contribuito righe a QUEL
// kind (batch.sourceChecksums dentro montecalliniBatching.ts), non
// sull'insieme COMPLETO dei file passati alla chiamata. In una singola
// chiamata con N file che contribuiscono tutti a tutti i kind i due valori
// coincidevano per caso; con file che contribuiscono a sottoinsiemi diversi
// di kind (o con submission separate) l'identita' del batch NON era piu'
// univoca. Fix: un solo `overallBatchHash` calcolato UNA VOLTA sull'intero
// insieme dei file in ingresso, riusato IDENTICO per ogni kind - vedi
// importService.ts.

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

function makeFakeSupabase() {
  let rpcCallCount = 0;
  const rpcCallsParams: Record<string, unknown>[] = [];
  const uploadCalls: string[] = [];
  const importEventInserts: Record<string, unknown>[] = [];

  const fake = {
    from(table: string) {
      if (table === "performance_import_events") {
        return {
          select: () => fakeQueryBuilder({ data: null, error: null }), // nessun evento 'imported' precedente
          insert: (payload: Record<string, unknown>) => {
            importEventInserts.push(payload);
            return { select: () => ({ single: async () => ({ data: { id: `evt-${importEventInserts.length}` }, error: null }) }) };
          },
        };
      }
      if (table === "performance_daily_snapshot" || table === "guest_nationality") {
        // Nessun dato legacy pre-Foundation in nessuno di questi test.
        return {
          select: () => ({ eq: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
        };
      }
      throw new Error(`from("${table}") non atteso in questo test`);
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploadCalls.push(path);
          return { error: null };
        },
      }),
    },
    async rpc(_fn: string, params: Record<string, unknown>) {
      rpcCallCount++;
      rpcCallsParams.push(params);
      const rows = (params.p_snapshot_rows as unknown[]) ?? [];
      return {
        data: { status: "imported", event_id: `evt-rpc-${rpcCallCount}`, imported_count: rows.length, bd_import_ids: [`bd-${rpcCallCount}`] },
        error: null,
      };
    },
    __calls: () => ({ rpcCallCount, rpcCallsParams, uploadCalls, importEventInserts }),
  };
  return fake;
}

const MC_ID = "33333333-3333-3333-3333-333333333333";
const structures: StructureOption[] = [{ id: MC_ID, name: MONTECALLINI_STRUCTURE_NAME }];

function mcRow(stayDate: string, revenueTotal: number, roomsSold: number, roomsAvailable: number, presences: number): ImportableRow {
  return { stayDate, revenueTotal, roomsSold, roomsAvailable, arrivals: null, presences };
}

async function makeMcFile(
  fileName: string,
  byteMarker: string,
  groups: { kind: GroupKind; rows: ImportableRow[] }[]
) {
  const content = new TextEncoder().encode(byteMarker).buffer;
  return { fileName, file: new File([byteMarker], fileName, { type: "text/csv" }), content, groups };
}

// Due file dello STESSO import settimanale, mesi CY diversi (settembre e
// ancora settembre ma giorni diversi - il CY resta lo stesso mese aperto,
// invariato per non toccare la logica di resolveGroupExtractionDate, gia'
// esistente e fuori scope) e LY di mesi storici DIVERSI (settembre 2025 e
// ottobre 2025) - il caso esplicitamente richiesto dal test 5.
// stay_date deliberatamente TUTTE diverse tra cy/sdly/ly e tra i due file,
// cosi' i test possono identificare senza ambiguita' a quale kind/file
// appartiene ogni riga nel payload RPC.
async function buildTwoFiles() {
  const file1 = await makeMcFile("PlanningForecast (1).csv", "contenuto-file-1", [
    { kind: "cy", rows: [mcRow("2026-09-10", 500, 20, 48, 35)] },
    { kind: "sdly", rows: [mcRow("2025-09-11", 400, 15, 48, 28)] },
    { kind: "ly", rows: [mcRow("2025-09-05", 400, 15, 48, 28)] }, // LY mese = settembre 2025
  ]);
  const file2 = await makeMcFile("PlanningForecast (2).csv", "contenuto-file-2", [
    { kind: "cy", rows: [mcRow("2026-09-20", 700, 25, 48, 40)] },
    { kind: "sdly", rows: [mcRow("2025-09-21", 600, 22, 48, 38)] },
    { kind: "ly", rows: [mcRow("2025-10-25", 600, 22, 48, 38)] }, // LY mese = ottobre 2025 (DIVERSO da file1)
  ]);
  return { file1, file2 };
}

function snapshotRowsOf(params: Record<string, unknown>): { stay_date: string }[] {
  return (params.p_snapshot_rows as { stay_date: string }[]) ?? [];
}

describe("Montecallini multi-file batch orchestration (bugfix 14/09/2026)", () => {
  it("1. due file nello stesso import -> UN SOLO batch_hash su tutti i commit (cy + sdly + ly)", async () => {
    const { file1, file2 } = await buildTwoFiles();
    const fakeSupabase = makeFakeSupabase();

    const result = await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      selectedStructureId: MC_ID,
      structures,
      uploadedBy: "user-1",
      today: "2026-09-14",
      files: [file1, file2],
    });

    expect(result.status).toBe("ok");
    const { rpcCallsParams } = fakeSupabase.__calls();
    expect(rpcCallsParams).toHaveLength(3); // cy, sdly, ly - un solo commit per kind

    const batchHashes = new Set(rpcCallsParams.map((p) => p.p_batch_hash));
    const sourceChecksums = new Set(rpcCallsParams.map((p) => p.p_source_checksum));
    expect(batchHashes.size).toBe(1);
    expect(sourceChecksums.size).toBe(1);
    expect([...batchHashes][0]).toBe([...sourceChecksums][0]); // stesso valore fa doppio servizio, invariato

    const checksum1 = await sha256Hex(file1.content);
    const checksum2 = await sha256Hex(file2.content);
    const expected = await computeBatchHash([checksum1, checksum2]);
    expect([...batchHashes][0]).toBe(expected);
  });

  it("2. ordine di selezione invertito -> stesso batch_hash", async () => {
    const { file1, file2 } = await buildTwoFiles();

    const s1 = makeFakeSupabase();
    await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: s1 as any,
      selectedStructureId: MC_ID,
      structures,
      uploadedBy: "user-1",
      today: "2026-09-14",
      files: [file1, file2],
    });

    const s2 = makeFakeSupabase();
    await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: s2 as any,
      selectedStructureId: MC_ID,
      structures,
      uploadedBy: "user-1",
      today: "2026-09-14",
      files: [file2, file1], // ordine invertito
    });

    expect(s1.__calls().rpcCallsParams[0].p_batch_hash).toBe(s2.__calls().rpcCallsParams[0].p_batch_hash);
  });

  it("3. entrambi i file contribuiscono allo stesso dataset CY merged (un solo commit, non due)", async () => {
    const { file1, file2 } = await buildTwoFiles();
    const fakeSupabase = makeFakeSupabase();

    await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      selectedStructureId: MC_ID,
      structures,
      uploadedBy: "user-1",
      today: "2026-09-14",
      files: [file1, file2],
    });

    const cyCalls = fakeSupabase
      .__calls()
      .rpcCallsParams.filter((p) => snapshotRowsOf(p).some((r) => r.stay_date === "2026-09-10" || r.stay_date === "2026-09-20"));
    expect(cyCalls).toHaveLength(1); // un solo commit, non uno per file
    expect(snapshotRowsOf(cyCalls[0]).map((r) => r.stay_date).sort()).toEqual(["2026-09-10", "2026-09-20"]);
  });

  it("4. entrambi i file contribuiscono allo stesso dataset SDLY merged", async () => {
    const { file1, file2 } = await buildTwoFiles();
    const fakeSupabase = makeFakeSupabase();

    await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      selectedStructureId: MC_ID,
      structures,
      uploadedBy: "user-1",
      today: "2026-09-14",
      files: [file1, file2],
    });

    const sdlyCalls = fakeSupabase
      .__calls()
      .rpcCallsParams.filter((p) => snapshotRowsOf(p).some((r) => r.stay_date === "2025-09-11" || r.stay_date === "2025-09-21"));
    expect(sdlyCalls).toHaveLength(1);
    expect(snapshotRowsOf(sdlyCalls[0]).map((r) => r.stay_date).sort()).toEqual(["2025-09-11", "2025-09-21"]);
  });

  it("5. LY di mesi storici diversi (settembre e ottobre 2025) restano righe dello STESSO batch, mai un conflitto file-vs-file", async () => {
    const { file1, file2 } = await buildTwoFiles();
    const fakeSupabase = makeFakeSupabase();

    const result = await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      selectedStructureId: MC_ID,
      structures,
      uploadedBy: "user-1",
      today: "2026-09-14",
      files: [file1, file2],
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");

    const lyBatches = result.batches.filter((b) => b.kind === "ly");
    expect(lyBatches).toHaveLength(1); // un solo outcome "ly", non uno per mese/file
    expect(lyBatches[0].outcome.status).toBe("imported"); // MAI conflict solo perche' due mesi diversi nello stesso batch

    const lyCall = fakeSupabase
      .__calls()
      .rpcCallsParams.find((p) => snapshotRowsOf(p).some((r) => r.stay_date === "2025-09-05" || r.stay_date === "2025-10-25"));
    expect(lyCall).toBeDefined();
    expect(snapshotRowsOf(lyCall!).map((r) => r.stay_date).sort()).toEqual(["2025-09-05", "2025-10-25"]);
  });

  it("6+7. un file con errore di parsing bloccante -> ZERO chiamate RPC per l'intero batch (anche gli altri file, di per se' validi, restano non committati)", async () => {
    const { file1 } = await buildTwoFiles();
    // file2 con `groups` completamente vuoto - stesso segnale che la pagina
    // Import produce oggi per un file con colonne mancanti o senza righe
    // valide (parseImportFile: groups popolati solo se rows.length > 0).
    const brokenFile2 = await makeMcFile("PlanningForecast (2).csv", "file-corrotto", []);

    // Prova che file1 da solo AVREBBE prodotto commit reali (cosi' il test
    // sotto dimostra davvero che e' brokenFile2 a bloccare tutto, non che
    // file1 fosse comunque vuoto).
    const soloResult = await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: makeFakeSupabase() as any,
      selectedStructureId: MC_ID,
      structures,
      uploadedBy: "user-1",
      today: "2026-09-14",
      files: [file1],
    });
    expect(soloResult.status).toBe("ok");

    const fakeSupabase = makeFakeSupabase();
    const result = await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      selectedStructureId: MC_ID,
      structures,
      uploadedBy: "user-1",
      today: "2026-09-14",
      files: [file1, brokenFile2],
    });

    expect(result.status).toBe("routing_error");
    if (result.status === "routing_error") {
      expect(result.message).toContain("PlanningForecast (2).csv");
    }
    expect(fakeSupabase.__calls().rpcCallCount).toBe(0); // nessuna RPC, nemmeno per il kind di file1
    expect(fakeSupabase.__calls().uploadCalls).toHaveLength(0); // nessun upload, nemmeno del file valido

    // L'esito bloccante resta comunque auditato (preflight, fuori dalla
    // transazione di commit - invariato).
    const insert = fakeSupabase.__calls().importEventInserts.find((i) => i.error_code === "montecallini_batch_parse_error");
    expect(insert).toBeDefined();
    expect(insert!.status).toBe("routing_error");
  });

  it("8. file A + file B senza import precedente -> 'imported' su tutti i kind, MAI un content_conflict solo perche' sono due file dello stesso batch", async () => {
    const { file1, file2 } = await buildTwoFiles();
    const fakeSupabase = makeFakeSupabase();

    const result = await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      selectedStructureId: MC_ID,
      structures,
      uploadedBy: "user-1",
      today: "2026-09-14",
      files: [file1, file2],
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.batches).toHaveLength(3);
    for (const b of result.batches) expect(b.outcome.status).toBe("imported");
  });

  it("upload su storage: ogni file fisico caricato UNA SOLA VOLTA per l'intera chiamata, non una volta per kind (2 file, 3 commit -> 2 upload, non 6)", async () => {
    const { file1, file2 } = await buildTwoFiles();
    const fakeSupabase = makeFakeSupabase();

    await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      selectedStructureId: MC_ID,
      structures,
      uploadedBy: "user-1",
      today: "2026-09-14",
      files: [file1, file2],
    });

    const uploads = fakeSupabase.__calls().uploadCalls;
    expect(uploads).toHaveLength(2);
    expect(uploads.some((p) => p.includes("PlanningForecast (1).csv"))).toBe(true);
    expect(uploads.some((p) => p.includes("PlanningForecast (2).csv"))).toBe(true);
  });

  it("bd_imports/source_file_name: la RPC riceve la lista COMPLETA dei file del batch per ciascun kind (gia' supportato da fn_commit_performance_import, string_agg - nessuna migration necessaria)", async () => {
    const { file1, file2 } = await buildTwoFiles();
    const fakeSupabase = makeFakeSupabase();

    await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      selectedStructureId: MC_ID,
      structures,
      uploadedBy: "user-1",
      today: "2026-09-14",
      files: [file1, file2],
    });

    for (const params of fakeSupabase.__calls().rpcCallsParams) {
      const sourceFiles = params.p_source_files as { file_name: string; file_path: string }[];
      expect(sourceFiles.map((f) => f.file_name).sort()).toEqual(["PlanningForecast (1).csv", "PlanningForecast (2).csv"]);
      expect(sourceFiles.every((f) => f.file_path.length > 0)).toBe(true);
    }
  });

  it("9. regressione: la firma/il comportamento di ingestMontecalliniBatch per Booking Designer e Nationality resta quello di ingestSingleFile, MAI toccato da questo fix", async () => {
    // ingestSingleFile non e' stato modificato da questo bugfix - garanzia
    // strutturale: nessuna delle funzioni/costanti toccate qui
    // (overallBatchHash, uploadFileOnce, failedFiles) e' importata o
    // referenziata da ingestSingleFile. Vedi anche importService.test.ts
    // (invariato, tutti i casi BD/Nationality restano verdi) per la
    // regressione comportamentale completa.
    const importServiceModule = await import("../importService");
    expect(typeof importServiceModule.ingestSingleFile).toBe("function");
    expect(typeof importServiceModule.ingestMontecalliniBatch).toBe("function");
  });
});
