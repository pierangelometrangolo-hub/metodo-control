-- ============ PROPOSTA — NON ESEGUIRE — Finance Core: documento normalizzato + righe ============
-- Dipende da: 20260816095000 (organizations/legal_entities), 20260816100000
-- (counterparties), 20260816104000 (finance_imports/source_documents),
-- 20260816105000 (classificazione).
--
-- finance_documents rappresenta il documento NORMALIZZATO, mai il raw -
-- niente source_type/source_file_name/source_file_hash/sdi_id qui (vivono
-- su finance_source_documents, collegati via source_document_id).

create table public.finance_documents (
  id uuid primary key default gen_random_uuid(),

  source_document_id uuid references public.finance_source_documents(id),  -- nullable: un inserimento manuale futuro (es. fattura cartacea senza XML) potrebbe non avere un source document
  legal_entity_id uuid references public.legal_entities(id),  -- nullable per ora: nessuna legal_entity esiste finche' non confermi i dati GAP (vedi 20260816095000) - organization e' sempre derivabile via legal_entities.organization_id, nessuna colonna ridondante qui

  -- Controparte: NON piu' NOT NULL. Il documento puo' essere acquisito
  -- anche a match non risolto - counterparty_resolution_status descrive
  -- lo stato del matching, mai una controparte inventata solo per
  -- soddisfare una FK.
  counterparty_id uuid references public.counterparties(id),
  counterparty_resolution_status text not null default 'unresolved',  -- 'matched' | 'pending' | 'proposed' | 'unresolved'

  structure_id uuid references public.structures(id),  -- opzionale, solo se la controparte e' anche struttura Performance

  direction text not null,  -- 'receivable' | 'payable'
  document_type text not null default 'invoice',  -- 'invoice' | 'credit_note' | 'storno' | ...
  document_number text not null,
  document_series text,  -- valore sorgente cosi' com'e' (es. 'V', 'L') - mapping verso il dominio economico e' lavoro futuro, non hard-coded qui
  document_date date not null,

  competence_from date,
  competence_to date,
  competence_status text not null default 'missing_data',  -- 'resolved' | 'missing_data' - mai inferita silenziosamente

  net_amount numeric not null,
  vat_amount numeric not null default 0,
  gross_amount numeric not null,
  economic_sign smallint not null default 1,  -- 1 = positivo, -1 = nota di credito/storno
  currency text not null default 'EUR',

  related_document_id uuid references public.finance_documents(id),  -- nota di credito -> fattura originale, quando gia' presente; il riferimento sorgente testuale (se il documento collegato non e' ancora stato importato) resta su finance_source_documents.raw_metadata

  -- Classificazione a livello DOCUMENTO. Regola: se tutte le righe
  -- condividono la stessa classificazione, l'header la eredita
  -- (classification_status='classified', BU/Project/Initiative popolati).
  -- Se le righe hanno classificazioni differenti tra loro, l'header resta
  -- SENZA BU/Project/Initiative e classification_status='classified_at_
  -- line_level' segnala esplicitamente che la classificazione vera vive
  -- sulle righe - le query Finance devono quindi controllare sia l'header
  -- sia finance_document_lines, mai solo l'header.
  business_unit_id uuid references public.finance_business_units(id),
  project_id uuid references public.finance_projects(id),
  initiative_id uuid references public.finance_initiatives(id),
  economic_category_id uuid references public.finance_economic_categories(id),
  classification_status text not null default 'unclassified',  -- 'unclassified' | 'classified' | 'classified_at_line_level' | 'needs_review'

  status text not null default 'active',  -- workflow: 'active' | 'superseded' | 'cancelled' | ...
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint finance_documents_direction_check check (direction in ('receivable', 'payable')),
  constraint finance_documents_competence_check check (
    (competence_status = 'missing_data' and competence_from is null and competence_to is null)
    or (competence_status = 'resolved' and competence_from is not null and competence_to is not null)
  ),
  constraint finance_documents_classification_status_check check (classification_status in ('unclassified', 'classified', 'classified_at_line_level', 'needs_review')),
  -- Applica la regola a livello database, non solo a livello applicativo:
  -- 'classified' richiede business_unit_id popolato (l'header afferma una
  -- classificazione, deve davvero averla); 'classified_at_line_level'
  -- richiede l'esatto opposto - header vuoto su tutta la terna, perche' la
  -- classificazione reale vive sulle righe, non sull'header stesso.
  constraint finance_documents_classification_consistency_check check (
    (classification_status = 'classified' and business_unit_id is not null)
    or (classification_status = 'classified_at_line_level' and business_unit_id is null and project_id is null and initiative_id is null)
    or (classification_status in ('unclassified', 'needs_review'))
  ),
  constraint finance_documents_counterparty_resolution_check check (counterparty_resolution_status in ('matched', 'pending', 'proposed', 'unresolved')),
  -- Se lo stato dichiara "matched", counterparty_id deve essere popolato -
  -- evita l'incoerenza opposta (match dichiarato ma FK vuota).
  constraint finance_documents_counterparty_matched_check check (
    (counterparty_resolution_status = 'matched' and counterparty_id is not null)
    or (counterparty_resolution_status != 'matched')
  )
);

create index idx_finance_documents_source_document on public.finance_documents(source_document_id);
create index idx_finance_documents_legal_entity on public.finance_documents(legal_entity_id);
create index idx_finance_documents_counterparty on public.finance_documents(counterparty_id);
create index idx_finance_documents_resolution_status on public.finance_documents(counterparty_resolution_status);
create index idx_finance_documents_structure on public.finance_documents(structure_id);
create index idx_finance_documents_business_unit on public.finance_documents(business_unit_id);
create index idx_finance_documents_competence on public.finance_documents(competence_from, competence_to);

-- Dedup layer 3 (fallback quando source_document_id/hash/sdi_id non
-- bastano da soli - vedi strategia completa nel messaggio, non solo in
-- SQL): chiave composita entita' legale + controparte + numero + serie.
-- Indice, non vincolo bloccante in inserimento - l'ingestion la userà per
-- segnalare "possibile doppione, needs_review", non per rifiutare
-- silenziosamente.
create index idx_finance_documents_business_key
  on public.finance_documents(legal_entity_id, counterparty_id, document_number, document_series, document_date);

-- Lookup diretto per numero+serie senza gia' conoscere la controparte -
-- utile durante l'ingestion quando il match counterparty non e' ancora
-- risolto (counterparty_resolution_status='unresolved'/'pending') ma si
-- vuole comunque cercare se un documento con lo stesso numero/serie esiste
-- gia'. Aggiunta in sede di revisione finale, prima non c'era.
create index idx_finance_documents_series_number
  on public.finance_documents(document_series, document_number);

alter table public.finance_documents enable row level security;
create policy finance_documents_select_authenticated on public.finance_documents for select to authenticated using (true);
create policy finance_documents_insert_senior_master on public.finance_documents for insert to authenticated with check (fn_user_level_rank(auth.uid()) >= 2);
create policy finance_documents_update_senior_master on public.finance_documents for update to authenticated using (fn_user_level_rank(auth.uid()) >= 2) with check (fn_user_level_rank(auth.uid()) >= 2);

-- ---------- finance_document_lines ----------
create table public.finance_document_lines (
  id uuid primary key default gen_random_uuid(),
  finance_document_id uuid not null references public.finance_documents(id),
  line_number int not null,

  description text,
  quantity numeric,
  unit text,
  unit_price numeric,
  net_amount numeric not null,
  vat_rate numeric,
  vat_amount numeric,
  service_period_from date,
  service_period_to date,

  -- Override di classificazione a livello riga - split allocation minimo,
  -- NON un Allocation Engine: quando NULL la riga eredita quella del
  -- documento, quando valorizzata la riga ha una classificazione propria.
  business_unit_id uuid references public.finance_business_units(id),
  project_id uuid references public.finance_projects(id),
  initiative_id uuid references public.finance_initiatives(id),
  economic_category_id uuid references public.finance_economic_categories(id),

  raw_metadata jsonb,
  created_at timestamptz not null default now(),

  constraint finance_document_lines_unique_line unique (finance_document_id, line_number)
);

create index idx_finance_document_lines_document on public.finance_document_lines(finance_document_id);

alter table public.finance_document_lines enable row level security;
create policy finance_document_lines_select_authenticated on public.finance_document_lines for select to authenticated using (true);
create policy finance_document_lines_insert_senior_master on public.finance_document_lines for insert to authenticated with check (fn_user_level_rank(auth.uid()) >= 2);
create policy finance_document_lines_update_senior_master on public.finance_document_lines for update to authenticated using (fn_user_level_rank(auth.uid()) >= 2) with check (fn_user_level_rank(auth.uid()) >= 2);
