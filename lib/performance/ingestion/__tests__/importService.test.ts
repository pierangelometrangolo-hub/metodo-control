import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { ingestMontecalliniBatch, ingestSingleFile } from "../importService";
import { parseBdExportCsv } from "../../../bdExportParser";
import { MONTECALLINI_STRUCTURE_NAME } from "../../../performanceImportRouting";
import { LEGACY_SNAPSHOT_CONFLICT_MESSAGE } from "../repository";
import { StructureAlias, StructureOption } from "../types";

// Doppio finto client Supabase, minimo indispensabile per esercitare
// ingestSingleFile/ingestMontecalliniBatch senza un DB reale - stesso
// principio di repository.ts (SupabaseClient passato come parametro, mai
// importato come singleton, proprio per restare testabile cosi').
//
// Ogni tabella non elencata qui lancia un errore esplicito se interrogata
// DIRETTAMENTE dal codice applicativo (JS) con un insert - e' proprio
// questo il punto del test E: l'unica scrittura DATI vera passa dalla RPC
// fn_commit_performance_import, mai da insert/delete sparsi lato client.
// performance_daily_snapshot/guest_nationality sono interrogabili SOLO in
// lettura (checkLegacySnapshotExists) - un insert diretto su queste due
// tabelle da qui indicherebbe una violazione di "zero scritture ai
// dataset" durante un conflitto legacy.
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

// Query builder per performance_daily_snapshot/guest_nationality: cattura
// il valore passato a .eq("extraction_date", ...) cosi' i test possono
// simulare "legacy presente SOLO per questa data" (fondamentale per il
// test 3, dove un solo kind/batch su piu' deve risultare in conflitto).
function fakeLegacyTableBuilder(legacyExtractionDates: string[]) {
  let capturedExtractionDate: string | undefined;
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: string) => {
      if (col === "extraction_date") capturedExtractionDate = val;
      return builder;
    },
    limit: () => builder,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const exists = capturedExtractionDate !== undefined && legacyExtractionDates.includes(capturedExtractionDate);
      return Promise.resolve({ data: exists ? [{ id: "legacy-row-1" }] : [], error: null }).then(resolve, reject);
    },
  };
  return builder;
}

type FakeSupabaseOptions = {
  aliases: StructureAlias[];
  priorEvent: { id: string; source_checksum: string | null; normalized_content_hash: string | null } | null;
  rpcResult?: { data?: unknown; error?: unknown };
  // extraction_date per cui performance_daily_snapshot/guest_nationality
  // devono risultare gia' popolate (dati legacy pre-Foundation) - default
  // nessuna, cioe' comportamento identico a prima di questa correzione.
  legacyExtractionDates?: string[];
};

function makeFakeSupabase(opts: FakeSupabaseOptions) {
  let rpcCallCount = 0;
  let uploadCallCount = 0;
  let rpcParams: Record<string, unknown> | null = null;
  const importEventInserts: Record<string, unknown>[] = [];
  let nextEventId = 1;

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
          select: () =>
            fakeQueryBuilder({
              data: opts.priorEvent,
              error: null,
            }),
          insert: (payload: Record<string, unknown>) => {
            importEventInserts.push(payload);
            const eventId = `evt-${nextEventId++}`;
            return {
              select: () => ({
                single: async () => ({ data: { id: eventId }, error: null }),
              }),
            };
          },
        };
      }
      if (table === "performance_daily_snapshot" || table === "guest_nationality") {
        return fakeLegacyTableBuilder(opts.legacyExtractionDates ?? []);
      }
      // Nessun altro nome di tabella e' atteso: una scrittura diretta su
      // bd_imports/performance_daily_snapshot/guest_nationality da qui
      // significherebbe che l'atomicita' NON e' piu' garantita solo
      // dall'RPC - il test deve fallire rumorosamente in quel caso.
      throw new Error(`from("${table}") non atteso: l'unica scrittura deve passare da fn_commit_performance_import`);
    },
    storage: {
      from: () => ({
        upload: async () => {
          uploadCallCount++;
          return { error: null };
        },
      }),
    },
    async rpc(_fnName: string, params: Record<string, unknown>) {
      rpcCallCount++;
      rpcParams = params;
      return opts.rpcResult ?? { data: null, error: null };
    },
    __calls: () => ({ rpcCallCount, uploadCallCount, rpcParams, importEventInserts }),
  };

  return fake;
}

const STRUCTURE_ID = "11111111-1111-1111-1111-111111111111";
const structures: StructureOption[] = [{ id: STRUCTURE_ID, name: "Villa Neviera Wine Resort" }];
const aliases: StructureAlias[] = [{ structureId: STRUCTURE_ID, source: "booking_designer", alias: "Villa Neviera Wine Resort" }];
const FILE_NAME = "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.csv";
const NATIONALITY_FILE_NAME = "Ospiti per provenienza (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-08.csv";

function makeFile(content: string, fileName = FILE_NAME): File {
  return new File([content], fileName, { type: "text/csv" });
}

describe("E. nessuna scrittura parziale su errore bloccante", () => {
  it("RPC che fallisce (errore Postgres) -> mai uno status 'imported', mai una scrittura diretta bd_imports/snapshot dal client, un solo tentativo RPC", async () => {
    const fakeSupabase = makeFakeSupabase({
      aliases,
      priorEvent: null, // nessun import precedente -> il pre-check locale sceglie "commit"
      rpcResult: { data: null, error: { message: "duplicate key value violates unique constraint" } },
    });

    const rows = [{ stayDate: "2026-01-01", revenueTotal: 100, roomsSold: 5, roomsAvailable: 10, arrivals: 1, presences: 8 }];

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
      snapshotRows: rows,
    });

    // Mai un falso "imported": l'unico messaggero dell'errore Postgres e'
    // il catch di ingestSingleFile, che lo traduce in parse_error - nessun
    // codice applicativo intercetta e "aggiusta" l'esito.
    expect(outcome.status).toBe("parse_error");

    // Un solo tentativo RPC (nessun retry silenzioso che potrebbe
    // mascherare scritture doppie) - e nessuna chiamata a from() su
    // bd_imports/performance_daily_snapshot/guest_nationality e' avvenuta
    // (altrimenti fakeSupabase.from() sopra avrebbe gia' lanciato).
    expect(fakeSupabase.__calls().rpcCallCount).toBe(1);
  });
});

describe("L. regressione file reale: il set di righe prodotto dalla pipeline coincide col parser, invariato dal refactor", () => {
  const REAL_FILES_DIR = path.join(process.cwd(), ".local-imports", "bd_villa_neviera_2026-09-01");
  const CSV_FILE = "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.csv";
  const filesAvailable = fs.existsSync(path.join(REAL_FILES_DIR, CSV_FILE));

  it.skipIf(!filesAvailable)(
    "365 righe del CSV reale Villa Neviera arrivano a p_snapshot_rows (payload RPC) esattamente come le ha lette il parser, nessuna persa/alterata/duplicata",
    async () => {
      const csvText = fs.readFileSync(path.join(REAL_FILES_DIR, CSV_FILE), "utf-8");
      const parsed = parseBdExportCsv(csvText);
      expect(parsed.rows).toHaveLength(365); // stessa attesa gia' validata in bdExportCsv.realFile.test.ts

      const fakeSupabase = makeFakeSupabase({
        aliases,
        priorEvent: null,
        rpcResult: { data: { status: "imported", event_id: "evt-1", imported_count: parsed.rows.length, bd_import_ids: ["bd-1"] }, error: null },
      });

      const fileContent = new TextEncoder().encode(csvText).buffer;

      const outcome = await ingestSingleFile({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: fakeSupabase as any,
        dataset: "adr_revpar",
        selectedStructureId: STRUCTURE_ID,
        structures,
        uploadedBy: "user-1",
        file: makeFile(csvText),
        fileContent,
        extractionDate: "2026-09-01",
        snapshotRows: parsed.rows,
      });

      expect(outcome.status).toBe("imported");

      const rpcParams = fakeSupabase.__calls().rpcParams as Record<string, unknown>;
      const sentRows = rpcParams.p_snapshot_rows as Record<string, unknown>[];

      // Stesso numero di righe, nessuna scartata/aggiunta dalla
      // normalizzazione.
      expect(sentRows).toHaveLength(parsed.rows.length);

      const sentByDate = new Map(sentRows.map((r) => [r.stay_date as string, r]));
      for (const parsedRow of parsed.rows) {
        const sent = sentByDate.get(parsedRow.stayDate);
        expect(sent, `riga ${parsedRow.stayDate} presente nel parser ma assente nel payload RPC`).toBeDefined();
        expect(sent!.revenue_total).toBeCloseTo(parsedRow.revenueTotal, 2);
        expect(sent!.rooms_sold).toBe(parsedRow.roomsSold);
        expect(sent!.rooms_available).toBe(parsedRow.roomsAvailable);
        expect(sent!.arrivals).toBe(parsedRow.arrivals);
        expect(sent!.presences).toBe(parsedRow.presences);
      }
    }
  );

  if (!filesAvailable) {
    it.skip(`file reale non trovato in ${REAL_FILES_DIR} - copiarlo li' per eseguire il test di regressione L`, () => {});
  }
});

// ============ Compatibilità snapshot legacy (correzione post-Fase 1) ============
// Gap reale scoperto sullo snapshot BD 08/09/2026 gia' in produzione:
// nessun performance_import_event esisteva per quella chiave, ma
// performance_daily_snapshot conteneva gia' righe scritte prima che questo
// sistema esistesse. I 3 test sotto (1/2/3, dataset diversi) verificano lo
// stesso comportamento richiesto: conflict/legacy_snapshot_present, zero
// scritture ai dataset, un evento di audit persistito - MAI una
// classificazione automatica come duplicato (nessun hash legacy da cui
// dedurla, verificato esplicitamente nel test 4).
describe("Compatibilità con snapshot legacy pre-Foundation (nessun performance_import_event, dati già presenti)", () => {
  it("1. legacy ADR/RevPAR presente, nessun evento -> conflict/legacy_snapshot_present, zero tentativi RPC/upload, evento auditato", async () => {
    const fakeSupabase = makeFakeSupabase({
      aliases,
      priorEvent: null,
      legacyExtractionDates: ["2026-09-08"],
    });

    const rows = [{ stayDate: "2026-01-01", revenueTotal: 100, roomsSold: 5, roomsAvailable: 10, arrivals: 1, presences: 8 }];

    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile("irrilevante"),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-08",
      snapshotRows: rows,
    });

    expect(outcome.status).toBe("conflict");
    if (outcome.status === "conflict") {
      expect(outcome.conflictingEventId).toBeNull(); // conflitto contro dati legacy, non contro un evento
      expect(outcome.eventId).toBeTruthy();
    }

    // Zero scritture ai dataset: mai un tentativo di RPC (che avrebbe
    // scritto bd_imports+snapshot), mai un upload del file sorgente.
    expect(fakeSupabase.__calls().rpcCallCount).toBe(0);
    expect(fakeSupabase.__calls().uploadCallCount).toBe(0);

    // 5. l'evento conflict resta persistito, con codice/messaggio esatti.
    const inserts = fakeSupabase.__calls().importEventInserts;
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      structure_id: STRUCTURE_ID,
      extraction_date: "2026-09-08",
      dataset: "adr_revpar",
      status: "conflict",
      error_code: "legacy_snapshot_present",
      error_message: LEGACY_SNAPSHOT_CONFLICT_MESSAGE,
    });
  });

  it("2. legacy Nazionalità presente, nessun evento -> stesso comportamento (conflict/legacy_snapshot_present, zero scritture, evento auditato)", async () => {
    const fakeSupabase = makeFakeSupabase({
      aliases,
      priorEvent: null,
      legacyExtractionDates: ["2026-09-08"],
    });

    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "nationality",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile("irrilevante", NATIONALITY_FILE_NAME),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-08",
      nationalityRows: [{ stayDate: "2026-09-08", nationality: "ITALIA", presences: 3 }],
    });

    expect(outcome.status).toBe("conflict");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(0);
    expect(fakeSupabase.__calls().uploadCallCount).toBe(0);

    const inserts = fakeSupabase.__calls().importEventInserts;
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      dataset: "nationality",
      status: "conflict",
      error_code: "legacy_snapshot_present",
      error_message: LEGACY_SNAPSHOT_CONFLICT_MESSAGE,
    });
  });

  it("3. legacy Montecallini presente SOLO per il kind CY -> quel batch va in conflict, il batch SDLY (data diversa) prosegue normalmente al commit", async () => {
    const MONTECALLINI_ID = "22222222-2222-2222-2222-222222222222";
    const montecalliniStructures: StructureOption[] = [{ id: MONTECALLINI_ID, name: MONTECALLINI_STRUCTURE_NAME }];

    // today="2026-09-08": il gruppo CY (righe di settembre 2026, mese
    // ancora in corso) risolve extraction_date="2026-09-08"; il gruppo
    // SDLY risolve sempre oggi-meno-un-anno="2025-09-08" - due date
    // DIVERSE, esattamente lo scope per cui il legacy va verificato per
    // ciascun batch separatamente.
    const fakeSupabase = makeFakeSupabase({
      aliases: [],
      priorEvent: null,
      legacyExtractionDates: ["2026-09-08"], // solo la data del batch CY
      rpcResult: { data: { status: "imported", event_id: "evt-rpc-sdly", imported_count: 1, bd_import_ids: ["bd-1"] }, error: null },
    });

    const file = makeFile("irrilevante-pms.csv", "PlanningForecast (SETT).csv");
    const batchResult = await ingestMontecalliniBatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      selectedStructureId: MONTECALLINI_ID,
      structures: montecalliniStructures,
      uploadedBy: "user-1",
      today: "2026-09-08",
      files: [
        {
          fileName: file.name,
          file,
          content: new TextEncoder().encode("irrilevante-pms.csv").buffer,
          groups: [
            { kind: "cy", rows: [{ stayDate: "2026-09-10", revenueTotal: 200, roomsSold: 5, roomsAvailable: 10, arrivals: 2, presences: 9 }] },
            { kind: "sdly", rows: [{ stayDate: "2025-09-10", revenueTotal: 150, roomsSold: 4, roomsAvailable: 10, arrivals: 1, presences: 7 }] },
          ],
        },
      ],
    });

    expect(batchResult.status).toBe("ok");
    if (batchResult.status !== "ok") throw new Error("unreachable");

    const cyOutcome = batchResult.batches.find((b) => b.kind === "cy")!.outcome;
    const sdlyOutcome = batchResult.batches.find((b) => b.kind === "sdly")!.outcome;

    // Il batch CY (data legacy) e' bloccato...
    expect(cyOutcome.status).toBe("conflict");
    // ...ma il batch SDLY (data diversa, nessun legacy) NON e' bloccato dal
    // conflitto dell'altro kind - stesso principio di scoping gia' in uso
    // per conflict/routing_error "normali".
    expect(sdlyOutcome.status).toBe("imported");

    // Un solo tentativo RPC (per SDLY) - CY non ha mai raggiunto la RPC.
    expect(fakeSupabase.__calls().rpcCallCount).toBe(1);

    const legacyInserts = fakeSupabase.__calls().importEventInserts.filter((i) => i.error_code === "legacy_snapshot_present");
    expect(legacyInserts).toHaveLength(1);
    expect(legacyInserts[0]).toMatchObject({
      extraction_date: "2026-09-08",
      dataset: "montecallini_pms",
      status: "conflict",
    });
  });

  it("4. nessun hash fittizio per il lato legacy: source_checksum/normalized_content_hash salvati sull'evento sono SEMPRE quelli reali del file/batch in ingresso, mai una ricostruzione a ritroso", async () => {
    const fakeSupabase = makeFakeSupabase({
      aliases,
      priorEvent: null,
      legacyExtractionDates: ["2026-09-08"],
    });

    const rows = [{ stayDate: "2026-01-01", revenueTotal: 100, roomsSold: 5, roomsAvailable: 10, arrivals: 1, presences: 8 }];
    const fileContent = new TextEncoder().encode("contenuto file di prova").buffer;

    await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile("contenuto file di prova"),
      fileContent,
      extractionDate: "2026-09-08",
      snapshotRows: rows,
    });

    const inserted = fakeSupabase.__calls().importEventInserts[0];

    // source_checksum salvato = SHA-256 REALE dei byte del file in
    // ingresso (64 esadecimali) - mai null/placeholder/inventato, e mai
    // un valore che pretenda di rappresentare il file legacy (che non
    // possiamo conoscere).
    expect(inserted.source_checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(inserted.normalized_content_hash).toMatch(/^[0-9a-f]{64}$/);
    // batch_hash e' null per un dataset a file singolo (adr_revpar) - MAI
    // un valore fittizio inventato per "riempire" la colonna.
    expect(inserted.batch_hash).toBeNull();
  });
});

// ============ Hardening: guardia transazionale finale (correzione post-Fase 1, terza revisione) ============
// Elimina la race documentata nel report precedente: pre-check TS
// (checkLegacySnapshotExists) -> finestra temporale -> RPC. Questi test
// simulano ESATTAMENTE quella finestra: il pre-check lato client non vede
// ancora nulla (legacyExtractionDates: [] - stesso stato di prima), ma la
// RPC (qui mockata per restituire cio' che la nuova guardia dentro
// fn_commit_performance_import, migration 20260908113200, produce quando
// intercetta lei stessa una riga legacy) risponde con un conflict
// strutturato invece di una violazione UNIQUE grezza. La correttezza della
// query SQL vera e propria (che la guardia scriva davvero un solo evento
// nella stessa transazione, prima di qualunque insert su
// bd_imports/performance_daily_snapshot) puo' essere verificata solo
// eseguendo la migration su un DB reale (fuori dalle possibilita' di
// questo ambiente) - questi test coprono il contratto lato client: come
// importService interpreta e propaga l'esito 'conflict' della RPC, senza
// mai tentare scritture aggiuntive o mascherarlo da errore generico.
describe("Hardening: guardia legacy dentro la RPC come rete di sicurezza sulla race pre-check/commit", () => {
  it("1. pre-check TS = nessun legacy, RPC vede legacy (race) -> conflict/legacy_snapshot_present propagato, zero scritture aggiuntive lato client, evento riferito quello restituito dalla RPC", async () => {
    const fakeSupabase = makeFakeSupabase({
      aliases,
      priorEvent: null,
      legacyExtractionDates: [], // il pre-check TS non vede nulla: la riga legacy "compare" solo dopo, vista dalla RPC
      rpcResult: {
        data: { status: "conflict", event_id: "evt-server-side-guard", conflicting_event_id: null },
        error: null,
      },
    });

    const rows = [{ stayDate: "2026-01-01", revenueTotal: 100, roomsSold: 5, roomsAvailable: 10, arrivals: 1, presences: 8 }];

    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile("irrilevante"),
      fileContent: new TextEncoder().encode("irrilevante").buffer,
      extractionDate: "2026-09-08",
      snapshotRows: rows,
    });

    expect(outcome.status).toBe("conflict");
    if (outcome.status === "conflict") {
      expect(outcome.eventId).toBe("evt-server-side-guard"); // l'evento e' quello scritto DALLA RPC, non un doppione lato client
      expect(outcome.conflictingEventId).toBeNull();
    }

    // Il pre-check TS ha lasciato proseguire verso commit (non vedeva
    // legacy) - upload e un solo tentativo RPC avvengono comunque, e' la
    // RPC stessa a rifiutare la scrittura: nessun retry, nessun secondo
    // tentativo che potrebbe scrivere due volte.
    expect(fakeSupabase.__calls().rpcCallCount).toBe(1);
    expect(fakeSupabase.__calls().uploadCallCount).toBe(1);

    // Nessun insert diretto di performance_import_events dal client per
    // questo esito: l'unico evento di audit e' quello scritto dentro la
    // transazione della RPC (qui simulato dal risultato mockato) - MAI un
    // doppio audit ridondante lato TypeScript.
    expect(fakeSupabase.__calls().importEventInserts).toHaveLength(0);
  });

  it("2. nessuna collisione UNIQUE grezza emerge nel caso sopra: l'esito resta un conflict strutturato, mai un parse_error con testo di errore Postgres generico", async () => {
    const fakeSupabase = makeFakeSupabase({
      aliases,
      priorEvent: null,
      legacyExtractionDates: [],
      rpcResult: {
        data: { status: "conflict", event_id: "evt-server-side-guard-2", conflicting_event_id: null },
        error: null,
      },
    });

    const rows = [{ stayDate: "2026-02-02", revenueTotal: 50, roomsSold: 2, roomsAvailable: 10, arrivals: 1, presences: 3 }];

    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile("irrilevante-2"),
      fileContent: new TextEncoder().encode("irrilevante-2").buffer,
      extractionDate: "2026-09-08",
      snapshotRows: rows,
    });

    // Mai un parse_error: la guardia dentro l'RPC restituisce un esito
    // STRUTTURATO (status='conflict'), mai un'eccezione con un messaggio
    // Postgres grezzo tipo "duplicate key value violates unique
    // constraint" che finirebbe qui rimappato a parse_error.
    expect(outcome.status).not.toBe("parse_error");
    expect(outcome.status).toBe("conflict");
    if ("message" in outcome) {
      expect(outcome.message).not.toMatch(/duplicate key|unique constraint/i);
    }
  });

  it("3. import normale (nessun legacy, nessun evento pregresso) resta atomico e verde: imported, un solo tentativo RPC, nessuna scrittura extra", async () => {
    const fakeSupabase = makeFakeSupabase({
      aliases,
      priorEvent: null,
      legacyExtractionDates: [],
      rpcResult: { data: { status: "imported", event_id: "evt-normal-1", imported_count: 1, bd_import_ids: ["bd-1"] }, error: null },
    });

    const rows = [{ stayDate: "2026-03-03", revenueTotal: 80, roomsSold: 3, roomsAvailable: 10, arrivals: 1, presences: 5 }];

    const outcome = await ingestSingleFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fakeSupabase as any,
      dataset: "adr_revpar",
      selectedStructureId: STRUCTURE_ID,
      structures,
      uploadedBy: "user-1",
      file: makeFile("irrilevante-3"),
      fileContent: new TextEncoder().encode("irrilevante-3").buffer,
      extractionDate: "2026-09-08",
      snapshotRows: rows,
    });

    expect(outcome.status).toBe("imported");
    expect(fakeSupabase.__calls().rpcCallCount).toBe(1);
    expect(fakeSupabase.__calls().uploadCallCount).toBe(1);
    expect(fakeSupabase.__calls().importEventInserts).toHaveLength(0); // nessun audit lato client per un import riuscito - solo la RPC scrive l'evento 'imported'
  });
});
