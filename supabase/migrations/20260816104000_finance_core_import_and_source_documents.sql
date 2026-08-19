-- ============ PROPOSTA — NON ESEGUIRE — Finance Core: import batch + source document raw ============
-- Principio non negoziabile: il raw source resta immutabile e recuperabile
-- a se', separato dal documento normalizzato. finance_documents (file
-- successivo) non contiene mai XML/hash/nome file grezzi - solo
-- source_document_id.
--
-- Dimensionato per il primo dataset reale: 188 fatture GAP 2025 + 45 GAP
-- 2026 = 233 documenti, probabilmente un unico batch ZIP per anno o per
-- invio - finance_imports traccia il batch, finance_source_documents ogni
-- singolo file al suo interno.

create table public.finance_imports (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,  -- 'xml_zip' | 'xml' | 'p7m' | 'api' | ...
  batch_reference text,  -- es. nome del file ZIP caricato
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'in_progress',  -- 'in_progress' | 'completed' | 'failed'
  documents_found int,
  documents_imported int,
  duplicates int,
  unresolved int,
  errors jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint finance_imports_status_check check (status in ('in_progress', 'completed', 'failed'))
);

create table public.finance_source_documents (
  id uuid primary key default gen_random_uuid(),
  finance_import_id uuid references public.finance_imports(id),

  source_type text not null,
  original_file_name text not null,
  source_file_hash text not null,
  sdi_id text,
  storage_reference text,  -- path/URL dove il file raw e' conservato - non il contenuto stesso, questa tabella non e' lo storage

  -- SOLO metadata di sorgente non normalizzati altrove (es. header XML
  -- grezzi utili per debug) - mai un duplicato di campi gia' presenti in
  -- modo strutturato su finance_documents.
  raw_metadata jsonb,

  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- Dedup layer 1 (il piu' forte): stesso file byte-per-byte non puo'
  -- essere importato due volte.
  constraint finance_source_documents_hash_unique unique (source_file_hash)
);

-- Dedup layer 2: SdI ID quando disponibile (identificativo assegnato dal
-- Sistema di Interscambio, forte quanto l'hash ma non sempre presente).
create unique index idx_finance_source_documents_sdi_id
  on public.finance_source_documents(sdi_id) where sdi_id is not null;

create index idx_finance_source_documents_import on public.finance_source_documents(finance_import_id);

alter table public.finance_imports enable row level security;
alter table public.finance_source_documents enable row level security;

create policy finance_imports_select_authenticated on public.finance_imports for select to authenticated using (true);
create policy finance_imports_write_senior_master on public.finance_imports for all to authenticated using (fn_user_level_rank(auth.uid()) >= 2) with check (fn_user_level_rank(auth.uid()) >= 2);

create policy finance_source_documents_select_authenticated on public.finance_source_documents for select to authenticated using (true);
create policy finance_source_documents_write_senior_master on public.finance_source_documents for all to authenticated using (fn_user_level_rank(auth.uid()) >= 2) with check (fn_user_level_rank(auth.uid()) >= 2);
