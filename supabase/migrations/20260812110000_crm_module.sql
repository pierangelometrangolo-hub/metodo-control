-- ============ MODULO CRM: schema, permessi, RLS ============
-- Anagrafica unificata clienti/contatti (Consulenza, Formazione, PDO).
-- Schema validato a monte, implementato cosi' com'e' - nessuna modifica.

-- ============ ENUM ============
create type crm_client_type as enum ('consulenza', 'formazione', 'pdo');
create type crm_client_status as enum ('prospect', 'attivo', 'ex_cliente');
create type crm_contract_status as enum ('attivo', 'non_definito', 'scaduto', 'disdetto');

-- ============ TABELLA ANAGRAFICA CLIENTI ============
create table crm_clients (
  id uuid primary key default gen_random_uuid(),

  business_name text not null,
  vat_number text,
  fiscal_code text,
  address text,
  postal_code text,
  sdi_code text,
  pec text,
  phone text,
  email text,
  website text,

  client_type crm_client_type not null,
  status crm_client_status not null default 'prospect',

  assigned_consultant_id uuid references profiles(id),

  -- solo per client_type = 'consulenza', nullable per gli altri tipi
  contract_start_date date,
  contract_end_date date,
  contract_status crm_contract_status,
  contract_notice_months integer,
  contract_document_url text,

  -- collegamento a Performance, sempre per ID, mai per stringa
  structure_id uuid references structures(id),

  -- solo per client_type = 'formazione', provenienza da PROSPECT_LEADS
  source_event text,
  acquired_at date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_crm_clients_type on crm_clients(client_type);
create index idx_crm_clients_status on crm_clients(status);
create index idx_crm_clients_structure on crm_clients(structure_id);
create index idx_crm_clients_consultant on crm_clients(assigned_consultant_id);

-- ============ REFERENTI ESTERNI (1:N per cliente) ============
create table crm_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  name text not null,
  role text not null default 'ND',
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create index idx_crm_contacts_client on crm_contacts(client_id);

-- ============ TRIGGER updated_at ============
-- Riusa public.set_updated_at(), gia' esistente e in uso identico su
-- tasks/subtasks (verificato via pg_get_functiondef prima di scrivere
-- questa migration) - nessuna nuova funzione, stesso trigger applicato a
-- crm_clients. crm_contacts non ha updated_at nello schema validato,
-- quindi nessun trigger li'.
create trigger trg_crm_clients_updated_at
before update on crm_clients
for each row
execute function set_updated_at();

-- ============ VISTA BADGE DI STATO DERIVATO ============
-- Logica calcolata qui, mai duplicata lato client.
create view v_crm_clients_badge as
select
  c.*,
  case
    when c.status = 'ex_cliente' then 'ex_cliente'
    when c.status = 'prospect' then 'prospect'
    when c.status = 'attivo' and c.client_type = 'consulenza' and c.contract_status = 'non_definito' then 'da_definire'
    when c.status = 'attivo' then 'attivo'
  end as badge_status
from crm_clients c;

-- security_invoker esplicito: stessa lezione del fix delle 5 view
-- SECURITY DEFINER del 12/08 - una view creata senza questa opzione gira
-- con i privilegi del proprietario e bypassa la RLS di crm_clients,
-- vanificando il gate su fn_user_can_view_module qui sotto. Impostata da
-- subito, non lasciata come default e corretta in un giro successivo.
alter view v_crm_clients_badge set (security_invoker = true);

-- ============ MODULO "crm" NEL SISTEMA PERMESSI ============
-- Non esisteva alcuna riga 'crm' in modules (verificato prima di scrivere
-- questa migration) - va aggiunta qui, non aggirata con un check diverso
-- nelle policy sotto.
insert into modules (key, name, sort_order) values
  ('crm', 'CRM', 7);

-- Confermato: modulo CRM visibile a tutti i livelli (user/senior/master).
insert into level_module_access (level, module_id, can_view)
select l, m.id, true
from unnest(array['user','senior','master']::user_level[]) as l
join modules m on m.key = 'crm';

-- ============ RLS ============
alter table crm_clients enable row level security;
alter table crm_contacts enable row level security;

-- Lettura: gate di modulo (fn_user_can_view_module), non di livello -
-- prima volta che questa funzione viene usata dentro una policy invece
-- che solo lato client, per la stessa ragione per cui esiste: rispetta
-- anche eventuali user_module_overrides futuri, non solo il default per
-- livello.
create policy crm_clients_select_module
on crm_clients
for select
to authenticated
using (fn_user_can_view_module(auth.uid(), 'crm'));

create policy crm_contacts_select_module
on crm_contacts
for select
to authenticated
using (fn_user_can_view_module(auth.uid(), 'crm'));

-- Scrittura: fn_user_level_rank, confermato rank >= 1 (tutti i livelli).
-- Soglia esplicita anche se equivale a "chiunque autenticato" - la regola
-- del progetto e' usare sempre fn_user_level_rank nelle policy, mai un
-- "true" nudo, cosi' se la soglia cambia in futuro si tocca solo il
-- numero, non si reintroduce la funzione da zero.
create policy crm_clients_insert
on crm_clients
for insert
to authenticated
with check (fn_user_level_rank(auth.uid()) >= 1);

create policy crm_clients_update
on crm_clients
for update
to authenticated
using (fn_user_level_rank(auth.uid()) >= 1)
with check (fn_user_level_rank(auth.uid()) >= 1);

create policy crm_clients_delete
on crm_clients
for delete
to authenticated
using (fn_user_level_rank(auth.uid()) >= 1);

create policy crm_contacts_insert
on crm_contacts
for insert
to authenticated
with check (fn_user_level_rank(auth.uid()) >= 1);

create policy crm_contacts_update
on crm_contacts
for update
to authenticated
using (fn_user_level_rank(auth.uid()) >= 1)
with check (fn_user_level_rank(auth.uid()) >= 1);

create policy crm_contacts_delete
on crm_contacts
for delete
to authenticated
using (fn_user_level_rank(auth.uid()) >= 1);
