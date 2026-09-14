import type { SupabaseClient } from "@supabase/supabase-js";
import { GroupKind, ImportableRow, resolveGroupExtractionDate } from "../../performanceImportRouting";
import { ParsedNationalityRow } from "../../nationalityParser";
import { Dataset, IngestionOutcome, NormalizedNationalityRow, NormalizedSnapshotRow, StructureOption } from "./types";
import { sha256Hex } from "./hashing";
import { computeBatchHash, computeNationalityContentHash, computeSnapshotContentHash } from "./normalization";
import { resolveMontecalliniStructure, resolveStructureForDataset, structureResolutionErrorMessage } from "./routing";
import { decideImportAction } from "./conflictPolicy";
import {
  CommitImportResult,
  checkLegacySnapshotExists,
  commitImport,
  findLatestImportedEvent,
  loadStructureAliases,
  logLegacySnapshotConflictEvent,
  logPreflightEvent,
  uploadSourceFile,
} from "./repository";
import { MontecalliniFileInput, buildMontecalliniBatches } from "./montecalliniBatching";
import { runGuardrails } from "../guardrails/runner";
import type { GuardrailFinding } from "../guardrails/types";
import {
  buildGuardrailBlockMessage,
  buildParserBlockMessage,
  classifyGuardrailErrorCode,
  classifyParserErrorCode,
} from "./validationError";

// Orchestrazione del servizio import Performance (upload manuale attuale +
// futura automazione Google Drive, NON implementata qui - "source" e'
// gia' un parametro esplicito ("manual_upload" oggi, "google_drive" mai
// prodotto da questo codice) proprio per restare comune ai due, senza che
// l'automazione Drive richieda di riscrivere questo file quando arrivera'.
//
// Pipeline (vedi anche il commento sulla migration
// fn_commit_performance_import per la parte 10-15):
//   1-2. format/dataset: gia' decisi dal chiamante (parseImportFile in
//        app/(control)/performance/import/page.tsx, invariato - qui non
//        si riparsano mai i file).
//   3. resolve struttura via alias DB (routing.ts) - o nome esatto
//      "Montecallini" per il dataset montecallini_pms.
//   4. extraction_date: invariato, calcolato dal chiamante
//      (resolveGroupExtractionDate, riusato qui solo per Montecallini).
//   5. parse: gia' fatto dal chiamante.
//   6-9. normalize + hash: qui sotto.
//   10-12. dedup/conflict: pre-check locale (conflictPolicy.ts) + verifica
//      finale autoritativa dentro l'RPC. In assenza di un evento
//      'imported' precedente, un controllo ESPLICITO aggiuntivo
//      (checkLegacySnapshotExists) verifica se il dataset target contiene
//      gia' righe scritte PRIMA che performance_import_events esistesse -
//      in quel caso l'esito e' SEMPRE conflict/legacy_snapshot_present,
//      mai una classificazione automatica come duplicato (nessun hash
//      legacy da cui dedurla) - vedi repository.ts.
//   13. guardrail esistenti (validazioni parser BD/RevPAR, controllo
//      cella-formato-data, ecc.): gia' applicati dal parser a monte,
//      nessuna duplicazione qui. STEP 3: un `parseErrors` non vuoto
//      passato dal chiamante (una VERA riga-dato non parsabile, mai una
//      riga strutturale attesa - TOTALE/footer/riga vuota, che il parser
//      non mette mai in errors) blocca l'intera unita' (file, o l'intero
//      batch multi-file Montecallini PRIMA della divisione per kind) -
//      validation_error, zero scritture. Nessuno snapshot parziale: mai
//      "riga esclusa, resto importato".
//   13-bis. Guardrails (lib/performance/guardrails/): eseguiti DOPO la
//      normalizzazione e PRIMA del calcolo hash/conflict/commit.
//      STEP 3 — enforcement: se hasBlockingFindings (solo GR-C06 e
//      GR-C01-QTY hanno severity="blocking" nel registry), l'unita'
//      bloccata e' il FILE per ADR/RevPAR e Nazionalita', il singolo KIND
//      (cy/sdly/ly) per Montecallini - MAI l'intero batch multi-file solo
//      perche' un kind ha un'anomalia (vedi validationError.ts). Le altre
//      findings (severity="warning"/"info") non bloccano mai e restano
//      solo in IngestionOutcome.guardrailFindings per la UI/il log - ne'
//      alterano normalized_content_hash ne' il payload della RPC in
//      nessun caso, bloccante o meno.
//   14-15. commit atomico + evento: repository.commitImport.

const BOOKING_DESIGNER_SOURCE = "booking_designer";
const BD_IMPORTS_SOURCE = "bd_export"; // valore storico invariato di bd_imports.source

function mapCommitResult(result: CommitImportResult): IngestionOutcome {
  if (result.status === "imported") {
    return { status: "imported", importedCount: result.imported_count, eventId: result.event_id, bdImportIds: result.bd_import_ids };
  }
  if (result.status === "skipped_duplicate") {
    return { status: "skipped_duplicate", reason: result.reason, eventId: result.event_id };
  }
  return { status: "conflict", eventId: result.event_id, conflictingEventId: result.conflicting_event_id };
}

type CommonParams = {
  supabase: SupabaseClient;
  selectedStructureId: string;
  structures: StructureOption[];
  uploadedBy: string;
};

// ---------- ADR/RevPAR e Nazionalità: un file = una unità di import ----------

export type SingleFileIngestParams = CommonParams & {
  dataset: Extract<Dataset, "adr_revpar" | "nationality">;
  file: File;
  fileContent: ArrayBuffer;
  extractionDate: string;
  snapshotRows?: ImportableRow[];
  nationalityRows?: ParsedNationalityRow[];
  // Errori del parser (lib/bdExportParser.ts / lib/nationalityParser.ts) su
  // VERE righe-dato - mai le righe strutturali attese (TOTALE, footer, riga
  // vuota di chiusura tabella), che i parser non mettono mai qui. STEP 3:
  // se non vuoto, blocca l'INTERO file (validation_error, zero scritture) -
  // mai "riga esclusa, resto importato". Opzionale/default [] per
  // retrocompatibilita' con i chiamanti che non lo passano ancora.
  parseErrors?: string[];
};

export async function ingestSingleFile(params: SingleFileIngestParams): Promise<IngestionOutcome> {
  const { supabase, dataset, selectedStructureId, structures, uploadedBy, file, fileContent, extractionDate } = params;
  const fileName = file.name;

  try {
    const aliases = dataset === "adr_revpar" || dataset === "nationality" ? await loadStructureAliases(supabase, BOOKING_DESIGNER_SOURCE) : [];
    const resolution = resolveStructureForDataset(dataset, fileName, aliases, structures);

    if (resolution.kind !== "resolved" || resolution.structureId !== selectedStructureId) {
      const selectedName = structures.find((s) => s.id === selectedStructureId)?.name ?? selectedStructureId;
      const message =
        resolution.kind === "resolved"
          ? `Il file appartiene a "${resolution.structureName}", ma hai selezionato "${selectedName}". Seleziona la struttura corretta prima di procedere.`
          : structureResolutionErrorMessage(resolution, structures);

      await logPreflightEvent(supabase, {
        status: "routing_error",
        structureId: resolution.kind === "resolved" ? resolution.structureId : null,
        extractionDate,
        dataset,
        source: "manual_upload",
        sourceFileName: fileName,
        errorCode: resolution.kind,
        errorMessage: message,
      });

      return { status: "routing_error", message };
    }

    // ============ STEP 3: parser error -> BLOCKING FILE (mai riga esclusa + resto importato) ============
    // `parseErrors` arriva dal chiamante (parseImportFile in
    // app/(control)/performance/import/page.tsx) - contiene SOLO errori su
    // VERE righe-dato (data non interpretabile, valore numerico
    // obbligatorio non parsabile, cella Revenue formato-data, colonne
    // obbligatorie assenti...). Le righe strutturali attese
    // (TOTALE/footer/riga vuota) non finiscono MAI qui: i parser le
    // saltano in silenzio o le mettono in excludedRows, non in errors -
    // nessuna modifica ai parser necessaria per questa distinzione, gia'
    // corretta da prima di questo step. Zero scritture: nessun checksum
    // calcolato ancora, nessun tentativo di normalizzazione.
    const parseErrors = params.parseErrors ?? [];
    if (parseErrors.length > 0) {
      const rowsSurvived = dataset === "nationality" ? (params.nationalityRows ?? []).length : (params.snapshotRows ?? []).length;
      const errorCode = classifyParserErrorCode(rowsSurvived);
      const message = buildParserBlockMessage(`il file "${fileName}"`, parseErrors);

      await logPreflightEvent(supabase, {
        status: "validation_error",
        structureId: selectedStructureId,
        extractionDate,
        dataset,
        source: "manual_upload",
        sourceFileName: fileName,
        errorCode,
        errorMessage: message,
      });

      return { status: "validation_error", message };
    }

    const sourceChecksum = await sha256Hex(fileContent);

    let normalizedContentHash: string;
    let snapshotRowsJson: Record<string, unknown>[] | null = null;
    let nationalityRowsJson: Record<string, unknown>[] | null = null;
    // Popolato subito dopo la normalizzazione, restituito tale e quale
    // nell'esito. STEP 3: se contiene una finding blocking, blocca il file
    // (vedi il controllo subito sotto, dopo la normalizzazione) - vedi
    // GUARDRAILS_SHADOW_MODE in lib/performance/guardrails/runner.ts.
    let guardrailFindings: GuardrailFinding[] = [];

    if (dataset === "nationality") {
      const rows: NormalizedNationalityRow[] = (params.nationalityRows ?? []).map((r) => ({
        stayDate: r.stayDate,
        nationality: r.nationality,
        presences: r.presences,
        sourceIndex: 0,
      }));
      normalizedContentHash = await computeNationalityContentHash(rows);
      nationalityRowsJson = rows.map((r) => ({
        stay_date: r.stayDate,
        nationality: r.nationality,
        presences: r.presences,
        source_index: r.sourceIndex,
      }));
      guardrailFindings = runGuardrails({
        dataset: "nationality",
        rows: rows.map((r) => ({ stayDate: r.stayDate, nationality: r.nationality, presences: r.presences })),
      }).findings;
    } else {
      const rows: NormalizedSnapshotRow[] = (params.snapshotRows ?? []).map((r) => ({
        stayDate: r.stayDate,
        revenueTotal: r.revenueTotal,
        roomsSold: r.roomsSold,
        roomsAvailable: r.roomsAvailable,
        arrivals: r.arrivals,
        presences: r.presences,
        sourceIndex: 0,
        // Diagnostico - mai scritto ne' hashato (vedi sotto snapshotRowsJson
        // e normalization.snapshotRowSignature).
        sourceKpi: r.sourceKpi,
      }));
      normalizedContentHash = await computeSnapshotContentHash(rows);
      snapshotRowsJson = rows.map((r) => ({
        stay_date: r.stayDate,
        revenue_total: r.revenueTotal,
        rooms_sold: r.roomsSold,
        rooms_available: r.roomsAvailable,
        arrivals: r.arrivals,
        presences: r.presences,
        source_index: r.sourceIndex,
      }));
      guardrailFindings = runGuardrails({ dataset: "adr_revpar", rows }).findings;
    }

    // ============ STEP 3: guardrail blocking -> BLOCKING FILE ============
    // Solo le findings con severity="blocking" (oggi: GR-C06 chiave
    // duplicata, GR-C01-QTY quantita' negativa - vedi registry.ts) arrivano
    // qui: tutte le altre (warning/info) non impostano MAI questo flag. Un
    // solo evento validation_error anche quando piu' findings blocking
    // coesistono nello stesso file (error_code sintetico
    // guardrail_validation_failed in quel caso - vedi validationError.ts).
    // PRIMA della verifica legacy/conflict: se dobbiamo bloccare non ha
    // senso interrogare performance_import_events/snapshot legacy per
    // questa chiave.
    if (guardrailFindings.some((f) => f.severity === "blocking")) {
      const errorCode = classifyGuardrailErrorCode(guardrailFindings);
      const message = buildGuardrailBlockMessage(guardrailFindings);

      await logPreflightEvent(supabase, {
        status: "validation_error",
        structureId: selectedStructureId,
        extractionDate,
        dataset,
        source: "manual_upload",
        sourceFileName: fileName,
        errorCode,
        errorMessage: message,
      });

      return { status: "validation_error", message, guardrailFindings };
    }

    const priorEvent = await findLatestImportedEvent(supabase, { structureId: selectedStructureId, extractionDate, dataset });

    if (!priorEvent) {
      // Nessun evento 'imported' per questa chiave - ma potrebbe comunque
      // esistere gia' uno snapshot scritto PRIMA di questo sistema
      // (esempio reale: lo snapshot BD 08/09/2026). Verifica ESPLICITA
      // prima di tentare qualunque insert, mai una collisione scoperta
      // solo dal vincolo UNIQUE dentro l'RPC.
      const legacyExists = await checkLegacySnapshotExists(supabase, { structureId: selectedStructureId, extractionDate, dataset });
      if (legacyExists) {
        const eventId = await logLegacySnapshotConflictEvent(supabase, {
          structureId: selectedStructureId,
          extractionDate,
          dataset,
          source: "manual_upload",
          sourceFileName: fileName,
          sourceChecksum,
          normalizedContentHash,
          batchHash: null,
        });
        // Zero scritture ai dataset: si esce qui, MAI si arriva
        // all'upload/RPC di commit per questa chiave.
        return { status: "conflict", eventId, conflictingEventId: null, guardrailFindings };
      }
    }

    const decision = decideImportAction(priorEvent, { sourceChecksum, normalizedContentHash });

    // Upload su storage SOLO se il pre-check locale suggerisce una scrittura
    // reale - evita un upload sprecato per un duplicato/conflitto gia'
    // riconoscibile prima di toccare la RPC (vedi nota "rischio orphan
    // object" nel report finale per il residuo di questa ottimizzazione:
    // un raro caso di race fra questo pre-check e la verifica autoritativa
    // dentro l'RPC puo' ancora lasciare un file caricato senza un
    // bd_imports che lo referenzi).
    let sourceFiles: { file_name: string; file_path: string }[];
    if (decision.action === "commit") {
      const storagePath = `${selectedStructureId}/${extractionDate}/${Date.now()}-${fileName}`;
      await uploadSourceFile(supabase, storagePath, file);
      sourceFiles = [{ file_name: fileName, file_path: storagePath }];
    } else {
      sourceFiles = [{ file_name: fileName, file_path: "" }];
    }

    const result = await commitImport(supabase, {
      structureId: selectedStructureId,
      extractionDate,
      dataset,
      source: "manual_upload",
      sourceChecksum,
      normalizedContentHash,
      batchHash: null,
      uploadedBy,
      bdImportsSource: BD_IMPORTS_SOURCE,
      reportType: dataset === "nationality" ? "nationality" : null,
      sourceFiles,
      snapshotRows: snapshotRowsJson,
      nationalityRows: nationalityRowsJson,
    });

    const outcome = mapCommitResult(result);
    outcome.guardrailFindings = guardrailFindings;
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "parse_error", message };
  }
}

// ---------- Montecallini: N file PlanningForecast = 1 batch per kind ----------

export type MontecalliniFileGroups = {
  fileName: string;
  file: File;
  content: ArrayBuffer;
  groups: { kind: GroupKind; rows: ImportableRow[] }[];
  // Errori del parser (lib/montecalliniPmsParser.ts) su VERE righe-dato di
  // QUESTO file - mai le righe strutturali attese (TOTALE/footer, gia' in
  // excludedRows, mai qui). STEP 3: se non vuoto per ALMENO UN file del
  // batch, blocca l'INTERO batch multi-file (validation_error, zero
  // scritture) - il parsing avviene PRIMA della divisione per kind, quindi
  // un file sorgente inaffidabile non puo' contribuire a nessun kind, non
  // solo al proprio. Opzionale/default [] per retrocompatibilita'.
  parseErrors?: string[];
};

export type MontecalliniBatchIngestParams = CommonParams & {
  files: MontecalliniFileGroups[];
  today: string;
};

export type MontecalliniBatchResult =
  | { status: "routing_error"; message: string }
  // STEP 3: errore parser su una vera riga-dato di uno o piu' file del
  // batch - blocca l'INTERO batch (tutti i kind, tutti i file), MAI un
  // singolo kind: il parsing e' file-wide, avviene prima della divisione
  // per kind, quindi un file inaffidabile non e' isolabile a un kind solo.
  | { status: "validation_error"; message: string }
  | { status: "ok"; batches: { kind: GroupKind; outcome: IngestionOutcome }[] };

export async function ingestMontecalliniBatch(params: MontecalliniBatchIngestParams): Promise<MontecalliniBatchResult> {
  const { supabase, selectedStructureId, structures, uploadedBy, files, today } = params;

  try {
    // Un solo controllo di routing per l'intero batch: il FORMATO (gia'
    // determinato a monte, invariato) e' cio' che identifica Montecallini,
    // non serve rifare la risoluzione per ciascun file/kind.
    const resolution = resolveMontecalliniStructure(structures);
    if (resolution.kind !== "resolved" || resolution.structureId !== selectedStructureId) {
      const selectedName = structures.find((s) => s.id === selectedStructureId)?.name ?? selectedStructureId;
      const message =
        resolution.kind === "resolved"
          ? `Il file appartiene a "${resolution.structureName}", ma hai selezionato "${selectedName}". Seleziona la struttura corretta prima di procedere.`
          : structureResolutionErrorMessage(resolution, structures);

      await logPreflightEvent(supabase, {
        status: "routing_error",
        structureId: resolution.kind === "resolved" ? resolution.structureId : null,
        extractionDate: null,
        dataset: "montecallini_pms",
        source: "manual_upload",
        sourceFileName: files.map((f) => f.fileName).join(", "),
        errorCode: resolution.kind,
        errorMessage: message,
      });

      return { status: "routing_error", message };
    }

    // ============ FASE 1: tutti i file caricati/parsati PRIMA di qualunque commit ============
    // `files` arriva qui gia' interamente parsato dal chiamante
    // (app/(control)/performance/import/page.tsx: parseImportFile gira per
    // intero, su TUTTI i file selezionati, PRIMA di questa chiamata - mai
    // dentro il loop di commit sotto). Qui restiamo comunque su un'unica
    // fase esplicita di lettura/hashing di TUTTI i file, prima di
    // costruire un solo batch/kind o di toccare la RPC.
    const checksumByFileName = new Map<string, string>();
    for (const f of files) checksumByFileName.set(f.fileName, await sha256Hex(f.content));

    // BUGFIX (14/09/2026): un file selezionato che non ha prodotto NESSUNA
    // riga importabile su NESSUN kind (colonne mancanti, file vuoto, errore
    // strutturale di parsing - gia' segnalato dal chiamante lasciando
    // `groups` vuoto per quel file, invariato) non deve piu' passare
    // silenziosamente: prima blocca solo se stesso (le altre righe del
    // batch venivano comunque committate, un file rotto spariva senza
    // traccia). Ora blocca l'INTERO batch Montecallini di questa chiamata -
    // "N file selezionati insieme = 1 batch", quindi un file bloccante
    // dentro quell'insieme blocca l'insieme, mai solo se stesso. Righe
    // strutturali attese (TOTALE/footer, gia' escluse dal parser in
    // `excludedRows`, mai in `groups`) non contano come errore qui: un file
    // legittimo con 0 righe in un solo kind (es. nessuna riga LY quel mese)
    // ha comunque gruppi non vuoti per gli altri kind.
    const failedFiles = files.filter((f) => f.groups.every((g) => g.rows.length === 0));
    if (failedFiles.length > 0) {
      const allFileNames = files.map((f) => f.fileName).join(", ");
      const message =
        failedFiles.length === 1
          ? `Il file "${failedFiles[0].fileName}" non ha prodotto nessuna riga valida. L'intero batch Montecallini (${files.length} file: ${allFileNames}) è stato bloccato - nessuna scrittura, correggere il file prima di ricaricare tutto il batch.`
          : `${failedFiles.length} file non hanno prodotto nessuna riga valida (${failedFiles.map((f) => f.fileName).join(", ")}). L'intero batch Montecallini (${files.length} file: ${allFileNames}) è stato bloccato - nessuna scrittura.`;

      await logPreflightEvent(supabase, {
        status: "routing_error",
        structureId: selectedStructureId,
        extractionDate: null,
        dataset: "montecallini_pms",
        source: "manual_upload",
        sourceFileName: allFileNames,
        errorCode: "montecallini_batch_parse_error",
        errorMessage: message,
      });

      return { status: "routing_error", message };
    }

    // ============ STEP 3: errore parser su una vera riga-dato -> BLOCKING BATCH ============
    // `parseErrors` (per file, gia' popolato dal chiamante - parseImportFile
    // in app/(control)/performance/import/page.tsx) contiene SOLO errori su
    // VERE righe-dato (data non interpretabile, valore numerico non
    // parsabile, CP>CV, quantita' negativa rilevata dal parser stesso...) -
    // mai righe strutturali attese (TOTALE/footer), che il parser mette
    // sempre in excludedRows, mai in errors. Se ALMENO UN file del batch ne
    // ha almeno uno, l'INTERO batch (tutti i file, tutti i kind) viene
    // bloccato QUI, PRIMA della divisione per kind (buildMontecalliniBatches
    // sotto non viene nemmeno chiamata): un file sorgente con dati non
    // affidabili non e' isolabile al solo kind a cui "sembra" appartenere,
    // perche' la sua inaffidabilita' e' scoperta PRIMA di sapere quali kind
    // popolera'. Zero RPC, zero upload, per NESSUN file del batch.
    const filesWithParseErrors = files.filter((f) => (f.parseErrors?.length ?? 0) > 0);
    if (filesWithParseErrors.length > 0) {
      const allFileNames = files.map((f) => f.fileName).join(", ");
      const allParseErrors = filesWithParseErrors.flatMap((f) => f.parseErrors ?? []);
      const rowsSurvived = filesWithParseErrors.reduce(
        (sum, f) => sum + f.groups.reduce((s, g) => s + g.rows.length, 0),
        0
      );
      const errorCode = classifyParserErrorCode(rowsSurvived);
      const message = buildParserBlockMessage(`il batch Montecallini (${files.length} file: ${allFileNames})`, allParseErrors);

      await logPreflightEvent(supabase, {
        status: "validation_error",
        structureId: selectedStructureId,
        extractionDate: null,
        dataset: "montecallini_pms",
        source: "manual_upload",
        sourceFileName: allFileNames,
        errorCode,
        errorMessage: message,
      });

      return { status: "validation_error", message };
    }

    // ============ Identita' del batch: UN SOLO hash sull'insieme COMPLETO dei file ============
    // Insieme ORDINATO dei source_checksum di TUTTI i file selezionati in
    // QUESTA chiamata (indipendente dall'ordine di selezione - vedi
    // normalization.computeBatchHash) - un solo valore, riusato IDENTICO
    // come source_checksum/batch_hash per OGNI kind (cy/sdly/ly) prodotto
    // da questa stessa chiamata.
    //
    // BUGFIX (14/09/2026): prima questo hash veniva ricalcolato PER KIND, a
    // partire dal sottoinsieme di checksum dei soli file che avevano
    // contribuito righe a QUEL kind (batch.sourceChecksums) - coerente solo
    // quando ogni file contribuisce a tutti e 3 i kind (il caso comune),
    // ma non e' la definizione richiesta ("N file selezionati insieme = 1
    // batch_hash"): un file che per qualunque motivo contribuisce a un
    // sottoinsieme diverso di kind rispetto agli altri produceva hash
    // diversi tra kind pur trattandosi dello stesso identico batch di
    // upload. Ora l'identita' del batch e' calcolata UNA SOLA VOLTA, qui,
    // sull'intero insieme di file in ingresso - MAI piu' derivata da
    // `batch.sourceChecksums` (che resta comunque necessario, sotto, per
    // sapere quali file appartengono a `bd_imports` di ciascun kind).
    const overallBatchHash = await computeBatchHash([...checksumByFileName.values()]);

    const batchInputs: MontecalliniFileInput[] = files.map((f) => ({
      fileName: f.fileName,
      filePath: "",
      sourceChecksum: checksumByFileName.get(f.fileName)!,
      groups: f.groups,
    }));

    const batches = buildMontecalliniBatches(batchInputs);
    const results: { kind: GroupKind; outcome: IngestionOutcome }[] = [];

    // Un file che contribuisce a piu' kind (il caso comune: lo stesso
    // PlanningForecast ha quasi sempre righe cy+sdly+ly) va caricato su
    // storage UNA SOLA VOLTA per l'intera chiamata - non piu' una volta per
    // ogni kind che lo referenzia. Il path e lo stesso formato di sempre
    // (invariato), solo calcolato/caricato la prima volta che serve e
    // riusato per i kind successivi: nessun cambio di schema/formato path,
    // nessun impatto su bd_imports (che resta comunque una riga per file
    // PER KIND commesso, invariato - qui cambia solo QUANTE VOLTE i byte
    // fisici vengono scritti su storage, mai quante righe bd_imports
    // vengono scritte).
    const uploadedPaths = new Map<string, string>();
    async function uploadFileOnce(fileName: string, extractionDateForPath: string): Promise<string> {
      const cached = uploadedPaths.get(fileName);
      if (cached) return cached;
      const storagePath = `${selectedStructureId}/${extractionDateForPath}/${Date.now()}-${fileName}`;
      const fileObj = files.find((f) => f.fileName === fileName)?.file;
      if (fileObj) await uploadSourceFile(supabase, storagePath, fileObj);
      uploadedPaths.set(fileName, storagePath);
      return storagePath;
    }

    for (const batch of batches) {
      const extractionDate = resolveGroupExtractionDate("montecallini_pms", batch.kind, batch.rows, today, today);
      const normalizedContentHash = await computeSnapshotContentHash(batch.rows);

      // Un run PER KIND (batch.rows e' gia' il singolo kind cy/sdly/ly),
      // cosi' GR-C06 rileva i duplicati di stay_date dentro il kind
      // corrente, mai fra kind diversi.
      const guardrailFindings = runGuardrails({ dataset: "montecallini_pms", rows: batch.rows }).findings;

      // ============ STEP 3: guardrail blocking -> BLOCKING SOLO QUESTO KIND ============
      // Enforcement PER KIND (mai l'intero batch multi-file): CY con un
      // duplicato blocca solo CY, SDLY/LY validi proseguono normalmente -
      // vedi il commento in testa al file. Solo severity="blocking"
      // (GR-C06, GR-C01-QTY) arriva qui; warning/info non impostano mai
      // questo ramo. `continue` passa al kind successivo, mai un abort
      // dell'intero batch.
      if (guardrailFindings.some((f) => f.severity === "blocking")) {
        const errorCode = classifyGuardrailErrorCode(guardrailFindings);
        const message = buildGuardrailBlockMessage(guardrailFindings);

        await logPreflightEvent(supabase, {
          status: "validation_error",
          structureId: selectedStructureId,
          extractionDate,
          dataset: "montecallini_pms",
          source: "manual_upload",
          sourceFileName: batch.sourceFiles.map((sf) => sf.fileName).join(", "),
          errorCode,
          errorMessage: message,
        });

        results.push({ kind: batch.kind, outcome: { status: "validation_error", message, guardrailFindings } });
        continue;
      }

      const priorEvent = await findLatestImportedEvent(supabase, {
        structureId: selectedStructureId,
        extractionDate,
        dataset: "montecallini_pms",
      });

      if (!priorEvent) {
        // Stesso controllo esplicito di ingestSingleFile, ma nell'ambito
        // (structure_id, extractionDate) GIA' risolto per QUESTO
        // batch/kind - mai quello di un altro kind dello stesso file. Un
        // conflitto legacy su un kind non blocca gli altri kind del batch
        // (stesso principio di scoping gia' in uso per conflict/routing_error).
        const legacyExists = await checkLegacySnapshotExists(supabase, {
          structureId: selectedStructureId,
          extractionDate,
          dataset: "montecallini_pms",
        });
        if (legacyExists) {
          const eventId = await logLegacySnapshotConflictEvent(supabase, {
            structureId: selectedStructureId,
            extractionDate,
            dataset: "montecallini_pms",
            source: "manual_upload",
            sourceFileName: batch.sourceFiles.map((sf) => sf.fileName).join(", "),
            sourceChecksum: overallBatchHash,
            normalizedContentHash,
            batchHash: overallBatchHash,
          });
          results.push({
            kind: batch.kind,
            outcome: { status: "conflict", eventId, conflictingEventId: null, guardrailFindings },
          });
          continue;
        }
      }

      const decision = decideImportAction(priorEvent, { sourceChecksum: overallBatchHash, normalizedContentHash });

      let sourceFiles: { file_name: string; file_path: string }[];
      if (decision.action === "commit") {
        sourceFiles = [];
        for (const sf of batch.sourceFiles) {
          const storagePath = await uploadFileOnce(sf.fileName, extractionDate);
          sourceFiles.push({ file_name: sf.fileName, file_path: storagePath });
        }
      } else {
        sourceFiles = batch.sourceFiles.map((sf) => ({ file_name: sf.fileName, file_path: "" }));
      }

      const result = await commitImport(supabase, {
        structureId: selectedStructureId,
        extractionDate,
        dataset: "montecallini_pms",
        source: "manual_upload",
        sourceChecksum: overallBatchHash,
        normalizedContentHash,
        batchHash: overallBatchHash,
        uploadedBy,
        bdImportsSource: BD_IMPORTS_SOURCE,
        reportType: null,
        sourceFiles,
        snapshotRows: batch.rows.map((r) => ({
          stay_date: r.stayDate,
          revenue_total: r.revenueTotal,
          rooms_sold: r.roomsSold,
          rooms_available: r.roomsAvailable,
          arrivals: r.arrivals,
          presences: r.presences,
          source_index: r.sourceIndex,
        })),
        nationalityRows: null,
      });

      const batchOutcome = mapCommitResult(result);
      batchOutcome.guardrailFindings = guardrailFindings;
      results.push({ kind: batch.kind, outcome: batchOutcome });
    }

    return { status: "ok", batches: results };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "routing_error", message };
  }
}
