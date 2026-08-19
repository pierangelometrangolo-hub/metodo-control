-- ============ PROPOSTA — NON ESEGUIRE — Finance Core: counterparties ============
-- Entita' Master Data generale per il Finance Core: rappresenta qualunque
-- controparte economica (cliente, fornitore, consulente, partner - un
-- soggetto puo' avere piu' ruoli). Non e' specifica di Consulting.
--
-- Perche' non basta crm_clients: crm_clients modella clienti (con campi
-- CRM-specifici: commissioni, contract_status, is_consulenza/formazione/
-- eventi/fornitore). Giorgia e' l'esempio concreto che ha fatto emergere il
-- limite - e' una FORNITRICE (fattura GAP a MC, ha una propria P.IVA), non
-- una cliente: oggi esiste solo come riga in `profiles` (utente reale
-- dell'app), non ha alcuna rappresentazione economico-fiscale.
--
-- counterparties e' quindi il livello sotto crm_clients/profiles/
-- structures, non li sostituisce: un cliente CRM operativo, un cliente
-- storico, un fornitore e un consulente sono tutti una riga counterparties
-- con collegamenti opzionali diversi.

create table public.counterparties (
  id uuid primary key default gen_random_uuid(),

  display_name text not null,
  legal_name text,
  vat_number text,
  fiscal_code text,
  country text,

  -- 'active' | 'inactive' - vocabolario minimo per questa nuova tabella
  -- (nessun retaggio da rispettare, a differenza di crm_clients.status).
  status text not null default 'active',

  -- Collegamenti opzionali, tutti indipendenti tra loro:
  --   crm_client_id: quando la controparte e' anche un cliente CRM
  --   profile_id: quando la controparte e' anche un utente reale di MC (Giorgia)
  --   structure_id: quando la controparte e' anche una struttura operativa Performance
  -- Nessuno dei tre e' obbligatorio - una counterparty storica senza CRM
  -- ne' Performance ha tutti e tre NULL, e resta comunque valida.
  crm_client_id uuid references public.crm_clients(id),
  profile_id uuid references public.profiles(id),
  structure_id uuid references public.structures(id),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint counterparties_status_check check (status in ('active', 'inactive'))
);

-- Unique strategy: una P.IVA reale non deve poter comparire su due
-- counterparty diverse (evita duplicati della stessa entita' fiscale) -
-- indice parziale perche' vat_number e' quasi sempre NULL per le
-- controparti storiche/non risolte, e piu' righe con vat_number NULL
-- devono poter coesistere.
create unique index idx_counterparties_vat_number
  on public.counterparties(vat_number) where vat_number is not null;

-- Stesso principio: un crm_client o un profile non devono poter essere
-- collegati a piu' di una counterparty (1:1 opzionale, non 1:N).
create unique index idx_counterparties_crm_client
  on public.counterparties(crm_client_id) where crm_client_id is not null;
create unique index idx_counterparties_profile
  on public.counterparties(profile_id) where profile_id is not null;

create index idx_counterparties_structure on public.counterparties(structure_id);

-- ---------- counterparty_roles ----------
-- Relazione, non enum piatto su counterparties: una controparte puo' avere
-- piu' ruoli contemporaneamente (es. teoricamente cliente E fornitore).
create table public.counterparty_roles (
  id uuid primary key default gen_random_uuid(),
  counterparty_id uuid not null references public.counterparties(id),
  role text not null,
  created_at timestamptz not null default now(),
  constraint counterparty_roles_role_check check (role in ('customer', 'supplier', 'consultant', 'partner')),
  constraint counterparty_roles_unique unique (counterparty_id, role)
);

alter table public.counterparties enable row level security;
alter table public.counterparty_roles enable row level security;

create policy counterparties_select_authenticated on public.counterparties for select to authenticated using (true);
create policy counterparties_insert_senior_master on public.counterparties for insert to authenticated with check (fn_user_level_rank(auth.uid()) >= 2);
create policy counterparties_update_senior_master on public.counterparties for update to authenticated using (fn_user_level_rank(auth.uid()) >= 2) with check (fn_user_level_rank(auth.uid()) >= 2);

create policy counterparty_roles_select_authenticated on public.counterparty_roles for select to authenticated using (true);
create policy counterparty_roles_insert_senior_master on public.counterparty_roles for insert to authenticated with check (fn_user_level_rank(auth.uid()) >= 2);
create policy counterparty_roles_delete_senior_master on public.counterparty_roles for delete to authenticated using (fn_user_level_rank(auth.uid()) >= 2);

-- ============ Backfill: le 6 consulenze attive gia' modellate in CRM ============
-- Derivato da dati gia' esistenti (crm_clients.structure_id), non
-- inventato: ogni struttura Performance attiva con is_consulenza=true ha
-- gia' un crm_clients corrispondente, qui diventa anche una counterparty.
insert into public.counterparties (display_name, legal_name, vat_number, structure_id, crm_client_id, status)
select
  s.name,               -- display_name = nome commerciale/operativo (es. "Palazzo Arco Cadura")
  c.business_name,      -- legal_name = ragione sociale gia' nota in CRM
  c.vat_number,
  c.structure_id,
  c.id,
  'active'
from public.crm_clients c
join public.structures s on s.id = c.structure_id
where c.is_consulenza = true;

insert into public.counterparty_roles (counterparty_id, role)
select id, 'customer' from public.counterparties where structure_id is not null;

-- Diagnostica: deve restituire 6 righe.
select display_name, legal_name, vat_number, structure_id is not null as ha_structure
from public.counterparties
order by display_name;
