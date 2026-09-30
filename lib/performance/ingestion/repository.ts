import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Dataset,
  ImportEventStatus,
  ImportSource,
  NormalizedNationalityRow,
  NormalizedSnapshotRow,
  StructureAlias,
} from "./types";
import { PriorImportedEvent, selectPriorImportedEvent, StayScope } from "./conflictPolicy";

// Tutto l'I/O Supabase del servizio import in un unico posto - nessuna
// query sparsa dentro importService.ts o dentro i componenti React.
// Nessuna logica di decisione qui dentro (quella vive in conflictPolicy.ts
// e, a runtime, nell'RPC): questo file legge/scrive soltanto.

export async function loadStructureAliases(supabase: SupabaseClient, source: string): Promise<StructureAlias[]> {
  const { data, error } = await supabase
    .from("structure_source_aliases")
    .select("structure_id, source, alias")
    .eq("source", source)
    .eq("is_active", true);

  if (error) throw new Error(`Impossibile caricare gli alias struttura: ${error.message}`);

  return (data ?? []).map((r) => ({
    structureId: r.structure_id as string,
    source: r.source as string,
    alias: r.alias as string,
  }));
}

// Evento 'imported' rilevante per questa chiave - null se non ne esiste
// nessuno. Tutti gli eventi 'imported' di structure_id + extraction_date +
// dataset (pochi per chiave), poi la stessa selezione per scope soggiorno
// della RPC (conflictPolicy.selectPriorImportedEvent): stayScope solo per
// montecallini_pms, null per gli altri dataset (evento piu' recente, come
// prima). Usato per l'anteprima UI - mai come autorita' finale: quella
// resta l'RPC, che rilegge la stessa informazione DENTRO la propria
// transazione.
export async function findLatestImportedEvent(
  supabase: SupabaseClient,
  params: { structureId: string; extractionDate: string; dataset: Dataset; stayScope?: StayScope | null }
): Promise<PriorImportedEvent | null> {
  const { data, error } = await supabase
    .from("performance_import_events")
    .select("id, source_checksum, normalized_content_hash, stay_date_start, stay_date_end")
    .eq("structure_id", params.structureId)
    .eq("extraction_date", params.extractionDate)
    .eq("dataset", params.dataset)
    .eq("status", "imported")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Impossibile verificare import precedenti: ${error.message}`);

  const events: PriorImportedEvent[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    sourceChecksum: (r.source_checksum as string | null) ?? null,
    normalizedContentHash: (r.normalized_content_hash as string | null) ?? null,
    stayDateStart: (r.stay_date_start as string | null) ?? null,
    stayDateEnd: (r.stay_date_end as string | null) ?? null,
  }));
  return selectPriorImportedEvent(events, params.stayScope ?? null);
}

export async function uploadSourceFile(supabase: SupabaseClient, storagePath: string, file: File): Promise<void> {
  const { error } = await supabase.storage.from("bd-import-files").upload(storagePath, file);
  if (error) throw new Error(`Errore caricamento file (${file.name}): ${error.message}`);
}

// ---------- Compatibilità snapshot legacy (correzione post-Fase 1) ----------
//
// Gap scoperto sullo snapshot BD 08/09/2026 gia' in produzione: quando NON
// esiste alcun performance_import_event 'imported' per una chiave
// (structure_id, extraction_date, dataset), il codice fin qui assumeva che
// non ci fosse NESSUN dato pregresso e procedeva dritto verso l'RPC di
// commit - per dati scritti PRIMA che questo sistema esistesse, l'RPC
// falliva sul vincolo UNIQUE di performance_daily_snapshot/guest_nationality
// con un errore Postgres generico, senza nessun evento di audit dedicato.
//
// Questa funzione verifica ESPLICITAMENTE la presenza di righe legacy
// PRIMA di tentare qualunque insert - stesso ambito (structure_id,
// extraction_date) del vincolo UNIQUE che altrimenti fallirebbe. Per
// adr_revpar E montecallini_pms la tabella e' la stessa
// (performance_daily_snapshot: non ha una colonna "dataset", il suo
// UNIQUE e' su structure_id+stay_date+extraction_date indipendentemente
// da quale dataset ha scritto le righe) - per Montecallini il chiamante
// passa qui l'extraction_date GIA' risolta per il singolo batch/kind
// (cy/sdly/ly), mai quella di un altro kind dello stesso file.
//
// Questo pre-check resta solo per UX/fast-fail (evita upload+RPC inutili
// nel caso comune): la stessa identica verifica e' ripetuta come guardia
// finale AUTORITATIVA dentro fn_commit_performance_import (migration
// 20260908113200), nella stessa transazione del commit - quella, non
// questa funzione, e' cio' che elimina davvero la finestra di race fra
// "controllo lato client" e "scrittura", esattamente come gia' avviene
// per exact/semantic duplicate e conflict via performance_import_events.
// stayScope (solo montecallini_pms, stessa regola della RPC): solo le righe
// dentro l'intervallo di soggiorno del file - righe di altri mesi sulla
// stessa extraction_date non sono lo stesso snapshot.
export async function checkLegacySnapshotExists(
  supabase: SupabaseClient,
  scope: { structureId: string; extractionDate: string; dataset: Dataset; stayScope?: StayScope | null }
): Promise<boolean> {
  const table = scope.dataset === "nationality" ? "guest_nationality" : "performance_daily_snapshot";

  let query = supabase
    .from(table)
    .select("id")
    .eq("structure_id", scope.structureId)
    .eq("extraction_date", scope.extractionDate);
  if (scope.stayScope) query = query.gte("stay_date", scope.stayScope.start).lte("stay_date", scope.stayScope.end);
  const { data, error } = await query.limit(1);

  if (error) throw new Error(`Impossibile verificare snapshot legacy (${table}): ${error.message}`);
  return (data ?? []).length > 0;
}

// ---------- Legacy equivalente (correzione post-Fase 1) ----------
//
// Righe legacy COMPLETE della chiave (structure_id, extraction_date), per
// ricostruirne il normalized_content_hash con la STESSA funzione usata per
// i nuovi import (normalization.ts) - mai una canonicalizzazione parallela.
// Stessa paginazione a pagine da 1000 gia' in uso in Dashboard
// (fetchAllSnapshotRows): PostgREST tronca silenziosamente oltre il
// max-rows, e una lettura parziale produrrebbe un hash diverso (conflitto
// spurio, mai un falso duplicato). Ordinamento totale sulla chiave UNIQUE
// della tabella, cosi' la paginazione e' deterministica.
const LEGACY_PAGE_SIZE = 1000;

async function fetchAllLegacyRows<T>(
  supabase: SupabaseClient,
  table: "performance_daily_snapshot" | "guest_nationality",
  columns: string,
  orderColumns: string[],
  scope: { structureId: string; extractionDate: string; stayScope?: StayScope | null }
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += LEGACY_PAGE_SIZE) {
    let query = supabase
      .from(table)
      .select(columns)
      .eq("structure_id", scope.structureId)
      .eq("extraction_date", scope.extractionDate);
    if (scope.stayScope) query = query.gte("stay_date", scope.stayScope.start).lte("stay_date", scope.stayScope.end);
    for (const col of orderColumns) query = query.order(col, { ascending: true });
    const { data, error } = await query.range(from, from + LEGACY_PAGE_SIZE - 1);

    if (error) throw new Error(`Impossibile leggere lo snapshot legacy (${table}): ${error.message}`);
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < LEGACY_PAGE_SIZE) return all;
  }
}

export async function loadLegacySnapshotRows(
  supabase: SupabaseClient,
  scope: { structureId: string; extractionDate: string; stayScope?: StayScope | null }
): Promise<NormalizedSnapshotRow[]> {
  type Row = {
    stay_date: string;
    revenue_total: number | string;
    rooms_sold: number | string;
    rooms_available: number | string;
    arrivals: number | string | null;
    presences: number | string;
  };
  const rows = await fetchAllLegacyRows<Row>(
    supabase,
    "performance_daily_snapshot",
    "stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences",
    ["stay_date"],
    scope
  );
  return rows.map((r) => ({
    stayDate: r.stay_date,
    revenueTotal: Number(r.revenue_total),
    roomsSold: Number(r.rooms_sold),
    roomsAvailable: Number(r.rooms_available),
    arrivals: r.arrivals === null ? null : Number(r.arrivals),
    presences: Number(r.presences),
    sourceIndex: 0,
  }));
}

export async function loadLegacyNationalityRows(
  supabase: SupabaseClient,
  scope: { structureId: string; extractionDate: string }
): Promise<NormalizedNationalityRow[]> {
  type Row = { stay_date: string; nationality: string; presences: number | string };
  const rows = await fetchAllLegacyRows<Row>(
    supabase,
    "guest_nationality",
    "stay_date, nationality, presences",
    ["stay_date", "nationality"],
    scope
  );
  return rows.map((r) => ({
    stayDate: r.stay_date,
    nationality: r.nationality,
    presences: Number(r.presences),
    sourceIndex: 0,
  }));
}

export const LEGACY_EQUIVALENT_MESSAGE =
  "Contenuto identico (stesso normalized_content_hash) a uno snapshot legacy già presente per questa struttura/data/dataset. Nessuna scrittura.";

// Registra l'esito 'skipped_duplicate' / legacy_equivalent - stesso
// principio di logLegacySnapshotConflictEvent (un solo insert, fuori da
// qualunque RPC, fallimento propagato). Gli hash salvati sono quelli del
// file/batch in ingresso: coincidono per definizione con quello
// ricostruito dal lato legacy.
export async function logLegacySnapshotEquivalentEvent(
  supabase: SupabaseClient,
  event: {
    structureId: string;
    extractionDate: string;
    dataset: Dataset;
    source: ImportSource;
    sourceFileName: string | null;
    sourceChecksum: string | null;
    normalizedContentHash: string | null;
    batchHash: string | null;
    stayScope?: StayScope | null;
  }
): Promise<string> {
  const { data, error } = await supabase
    .from("performance_import_events")
    .insert({
      structure_id: event.structureId,
      extraction_date: event.extractionDate,
      dataset: event.dataset,
      source: event.source,
      status: "skipped_duplicate",
      source_checksum: event.sourceChecksum,
      normalized_content_hash: event.normalizedContentHash,
      batch_hash: event.batchHash,
      source_file_name: event.sourceFileName,
      stay_date_start: event.stayScope?.start ?? null,
      stay_date_end: event.stayScope?.end ?? null,
      error_code: "legacy_equivalent",
      error_message: LEGACY_EQUIVALENT_MESSAGE,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Impossibile registrare l'evento legacy equivalente: ${error?.message}`);
  return data.id as string;
}

export const LEGACY_SNAPSHOT_CONFLICT_MESSAGE =
  "Esiste già uno snapshot precedente alla Import Integrity Foundation per questa struttura/data/dataset. Non è possibile stabilire automaticamente se il file sia duplicato o differente. Import bloccato e richiesta verifica umana.";

// Registra l'esito 'conflict' per un legacy_snapshot_present - un SOLO
// insert, mai avvolto nella transazione dell'RPC di commit: cosi' l'evento
// di audit esiste indipendentemente dal fatto che un commit sia mai stato
// tentato (nessun rollback di dati puo' "portarsi via" questo evento, dato
// che qui non viene scritto nessun dato di dataset). A differenza di
// logPreflightEvent (best-effort), qui un fallimento dell'insert viene
// propagato: l'utente ha chiesto esplicitamente che l'audit del conflitto
// legacy sia garantito, non "a tentativo".
//
// MAI un source_checksum/normalized_content_hash inventato per il lato
// legacy - i valori salvati qui sono SEMPRE e SOLO quelli del file/batch
// in ingresso appena calcolati dal chiamante. L'hash ricostruito dalle
// righe legacy (loadLegacySnapshotRows/loadLegacyNationalityRows) serve
// solo al confronto, non viene mai salvato.
export async function logLegacySnapshotConflictEvent(
  supabase: SupabaseClient,
  event: {
    structureId: string;
    extractionDate: string;
    dataset: Dataset;
    source: ImportSource;
    sourceFileName: string | null;
    sourceChecksum: string | null;
    normalizedContentHash: string | null;
    batchHash: string | null;
    stayScope?: StayScope | null;
  }
): Promise<string> {
  const { data, error } = await supabase
    .from("performance_import_events")
    .insert({
      structure_id: event.structureId,
      extraction_date: event.extractionDate,
      dataset: event.dataset,
      source: event.source,
      status: "conflict",
      source_checksum: event.sourceChecksum,
      normalized_content_hash: event.normalizedContentHash,
      batch_hash: event.batchHash,
      source_file_name: event.sourceFileName,
      stay_date_start: event.stayScope?.start ?? null,
      stay_date_end: event.stayScope?.end ?? null,
      error_code: "legacy_snapshot_present",
      error_message: LEGACY_SNAPSHOT_CONFLICT_MESSAGE,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Impossibile registrare l'evento di conflitto legacy: ${error?.message}`);
  return data.id as string;
}

export type CommitImportParams = {
  structureId: string;
  extractionDate: string;
  dataset: Dataset;
  source: ImportSource;
  sourceChecksum: string;
  normalizedContentHash: string;
  batchHash: string | null;
  uploadedBy: string;
  bdImportsSource: string; // valore storico di bd_imports.source - sempre "bd_export", invariato
  reportType: string | null; // "nationality" solo per il dataset nationality, invariato
  sourceFiles: { file_name: string; file_path: string }[];
  snapshotRows: Record<string, unknown>[] | null;
  nationalityRows: Record<string, unknown>[] | null;
};

export type CommitImportResult =
  | { status: "imported"; event_id: string; imported_count: number; bd_import_ids: string[] }
  | { status: "skipped_duplicate"; reason: "exact_duplicate" | "semantic_duplicate"; event_id: string }
  | {
      status: "conflict";
      // Presente dalla migration 20260930130000 (content_conflict |
      // scope_overlap | legacy_snapshot_present); assente dalla versione
      // precedente della RPC.
      reason?: "content_conflict" | "scope_overlap" | "legacy_snapshot_present";
      event_id: string;
      conflicting_event_id: string | null;
    };

// Unico punto di scrittura - vedi fn_commit_performance_import (migration
// 20260908113200) per la garanzia di atomicita'. Il caso "dati legacy
// pre-Foundation sulla stessa chiave" NON arriva piu' qui come una
// violazione grezza del vincolo UNIQUE: la RPC stessa lo intercetta prima
// di scrivere e restituisce un CommitImportResult 'conflict' regolare
// (error_code='legacy_snapshot_present' sulla riga di audit) - vedi la
// guardia dentro la migration. Qualunque ALTRO errore imprevisto qui (RPC
// fallita per un motivo diverso) arriva come eccezione: nessuna scrittura
// parziale, il chiamante lo traduce in un evento parse_error via
// logPreflightEvent.
export async function commitImport(supabase: SupabaseClient, params: CommitImportParams): Promise<CommitImportResult> {
  const { data, error } = await supabase.rpc("fn_commit_performance_import", {
    p_structure_id: params.structureId,
    p_extraction_date: params.extractionDate,
    p_dataset: params.dataset,
    p_source: params.source,
    p_source_checksum: params.sourceChecksum,
    p_normalized_content_hash: params.normalizedContentHash,
    p_batch_hash: params.batchHash,
    p_uploaded_by: params.uploadedBy,
    p_bd_source: params.bdImportsSource,
    p_report_type: params.reportType,
    p_source_files: params.sourceFiles,
    p_snapshot_rows: params.snapshotRows,
    p_nationality_rows: params.nationalityRows,
  });

  if (error) throw new Error(`Errore scrittura import: ${error.message}`);
  return data as CommitImportResult;
}

// Log "pre-flight" (routing_error / parse_error / validation_error) - MAI
// dentro la transazione dell'RPC (che scrive solo imported/skipped_duplicate/
// conflict): questi tre esiti accadono PRIMA di arrivare li', quando non
// c'e' ancora nulla da rendere atomico. Un fallimento di questo insert e'
// deliberatamente "best effort": non deve mai nascondere all'utente
// l'errore originale che stava gia' per essere mostrato.
export async function logPreflightEvent(
  supabase: SupabaseClient,
  event: {
    status: Extract<ImportEventStatus, "routing_error" | "parse_error" | "validation_error">;
    structureId: string | null;
    extractionDate: string | null;
    dataset: Dataset;
    source: ImportSource;
    sourceFileName: string | null;
    errorCode: string;
    errorMessage: string;
  }
): Promise<void> {
  await supabase.from("performance_import_events").insert({
    structure_id: event.structureId,
    extraction_date: event.extractionDate,
    dataset: event.dataset,
    source: event.source,
    status: event.status,
    source_file_name: event.sourceFileName,
    error_code: event.errorCode,
    error_message: event.errorMessage,
  });
}
