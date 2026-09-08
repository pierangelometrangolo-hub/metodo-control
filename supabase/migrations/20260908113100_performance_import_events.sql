-- ============ Import Integrity Foundation (Fase 1) — performance_import_events ============
-- Audit trail di OGNI file/batch osservato dal servizio di import
-- (lib/performance/ingestion/), non solo quelli scritti con successo -
-- comune a upload manuale attuale e a una futura automazione Google Drive
-- (source gia' estensibile a 'google_drive', non implementata in questa
-- fase). NON chiamata drive_import_events di proposito: non e' specifica
-- di Drive.
create table performance_import_events (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid references structures(id),
  extraction_date date,
  dataset text not null,
  source text not null,

  -- Tre hash concettualmente diversi, mai confusi sotto un unico nome
  -- generico "content_checksum" - vedi lib/performance/ingestion/hashing.ts:
  --   source_checksum         = SHA-256 dei byte ESATTI del file sorgente
  --                              (identita' tecnica: stesso file ricaricato
  --                              anche con nome diverso -> stesso hash).
  --   normalized_content_hash = SHA-256 dei dati RIGA PER RIGA dopo
  --                              parsing+normalizzazione (identita'
  --                              semantica: due file tecnicamente diversi
  --                              ma con lo stesso contenuto risultante
  --                              producono lo stesso hash).
  --   batch_hash               = SHA-256 dell'insieme ORDINATO dei
  --                              source_checksum dei singoli file che
  --                              compongono un batch multi-file (oggi solo
  --                              Montecallini: N PlanningForecast CSV = 1
  --                              batch per kind CY/SDLY/LY) - indipendente
  --                              dall'ordine di selezione dei file.
  source_checksum text,
  normalized_content_hash text,
  batch_hash text,

  status text not null,
  bd_import_id uuid references bd_imports(id),
  source_file_name text,
  error_code text,
  error_message text,

  -- Risoluzione conflitto: FUORI SCOPE in questa fase (si rileva, si
  -- blocca, si audita - non si risolve da UI), ma le colonne servono da
  -- subito per non dover fare un'altra migration quando la risoluzione
  -- verra' costruita.
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,

  created_at timestamptz not null default now(),

  constraint performance_import_events_dataset_check
    check (dataset in ('adr_revpar', 'nationality', 'montecallini_pms')),
  constraint performance_import_events_source_check
    check (source in ('manual_upload', 'google_drive')),
  constraint performance_import_events_status_check
    check (status in ('imported', 'skipped_duplicate', 'conflict', 'routing_error', 'parse_error', 'validation_error'))
);

-- Query piu' frequente del servizio: "esiste gia' un import completato per
-- questa struttura+data+dataset?" (dedup/conflict, vedi fn_commit_performance_import).
create index performance_import_events_dedup_idx
  on performance_import_events (structure_id, extraction_date, dataset, status);

create index performance_import_events_created_at_idx on performance_import_events (created_at desc);

comment on table performance_import_events is
  'Audit trail di ogni file/batch osservato dal servizio import Performance (lib/performance/ingestion/), incluse le righe non scritte (conflict/routing_error/parse_error/validation_error) - MAI solo gli import riusciti (quello resta bd_imports, invariato). structure_id/extraction_date nullable: un routing_error puo'' avvenire prima ancora di sapere quale struttura fosse.';
comment on column performance_import_events.dataset is
  'adr_revpar | nationality | montecallini_pms - MAI il formato file (xls/csv), quello e'' gia'' un dettaglio del parsing.';
comment on column performance_import_events.source is
  'Come e'' arrivato il file: manual_upload (unico valore usato oggi) o google_drive (valore riservato per una futura automazione, non implementata in questa fase).';
comment on column performance_import_events.status is
  'imported = scrittura completata (bd_import_id valorizzato). skipped_duplicate = stesso source_checksum o stesso normalized_content_hash di un import gia'' completato, nessuna scrittura, mai un errore. conflict = stessa struttura+data+dataset ma normalized_content_hash diverso da un import gia'' completato: bloccante, zero scritture, richiede risoluzione umana (fuori scope qui). routing_error/parse_error/validation_error = bloccante prima di arrivare alla scrittura.';

alter table performance_import_events enable row level security;

-- Stessa soglia di structure_source_aliases/performance_daily_snapshot:
-- rank >= 2. INSERT necessaria perche' il servizio scrive qui da app
-- (client-side, utente autenticato) sia per gli esiti di successo sia per
-- quelli bloccanti - mai da service role soltanto.
create policy performance_import_events_select_senior_master
on performance_import_events
for select
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);

create policy performance_import_events_insert_senior_master
on performance_import_events
for insert
to authenticated
with check (fn_user_level_rank(auth.uid()) >= 2);
