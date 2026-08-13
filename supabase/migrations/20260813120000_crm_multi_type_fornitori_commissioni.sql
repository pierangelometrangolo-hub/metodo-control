-- ============ CRM: da client_type singolo a flag multipli + fornitori + commissioni ============
-- Cambiamento sostanziale rispetto a 20260812110000/20260812111500: un cliente
-- puo' essere Consulenza + Formazione + Eventi contemporaneamente (era un
-- enum singolo). "PDO" diventa "Eventi" in tutta la UI, il valore a DB resta
-- is_eventi (nessuna traccia del nome PDO se non qui come sinonimo storico).

-- ============ PARTE A: flag di tipo ============
alter table crm_clients
  add column is_consulenza boolean not null default false,
  add column is_formazione boolean not null default false,
  add column is_eventi boolean not null default false,
  add column is_fornitore boolean not null default false;

update crm_clients set is_consulenza = true where client_type = 'consulenza';
update crm_clients set is_formazione = true where client_type = 'formazione';
update crm_clients set is_eventi = true where client_type = 'pdo';

alter table crm_clients
  add constraint crm_clients_at_least_one_type
  check (is_consulenza or is_formazione or is_eventi);

drop view v_crm_clients_badge;
alter table crm_clients drop column client_type;
drop type crm_client_type;

create index idx_crm_clients_is_consulenza on crm_clients(is_consulenza);
create index idx_crm_clients_is_formazione on crm_clients(is_formazione);
create index idx_crm_clients_is_eventi on crm_clients(is_eventi);
create index idx_crm_clients_is_fornitore on crm_clients(is_fornitore);

-- ============ PARTE A: nuovi campi anagrafica e commissioni ============
-- cin/cis/notes: nessuna restrizione di lettura, visibili su qualunque
-- combinazione di tipo. commission_*: pertinenti solo se is_consulenza,
-- nessun vincolo rigido a DB (stessa logica gia' in uso per contract_* -
-- validazione lato form, non check SQL).
alter table crm_clients
  add column cin text,
  add column cis text,
  add column notes text,
  add column commission_type text check (commission_type in ('percentuale', 'fisso_piu_override')),
  add column commission_percentage numeric,
  add column commission_fixed_amount numeric,
  add column commission_fixed_months numeric,
  add column commission_override_percentage numeric,
  add column commission_override_threshold numeric;

-- ============ PARTE B: vista badge di stato derivato, ricreata sui nuovi flag ============
-- security_invoker esplicito, stessa lezione gia' applicata la prima volta:
-- una view senza questa opzione gira con i privilegi del proprietario e
-- bypassa la RLS di crm_clients.
create view v_crm_clients_badge as
select
  c.*,
  case
    when c.status = 'ex_cliente' then 'ex_cliente'
    when c.status = 'prospect' then 'prospect'
    when c.status = 'attivo' and c.is_consulenza and c.contract_status = 'non_definito' then 'da_definire'
    when c.status = 'attivo' then 'attivo'
  end as badge_status
from crm_clients c;

alter view v_crm_clients_badge set (security_invoker = true);

-- ============ PARTE C: RLS crm_clients - insert/update/delete ristretti a senior/master ============
-- crm_contacts NON tocca: resta fn_user_level_rank >= 1 come gia' validato.
drop policy if exists crm_clients_insert on crm_clients;
drop policy if exists crm_clients_update on crm_clients;
drop policy if exists crm_clients_delete on crm_clients;

create policy crm_clients_insert
on crm_clients for insert to authenticated
with check (fn_user_level_rank(auth.uid()) >= 2);

create policy crm_clients_update
on crm_clients for update to authenticated
using (fn_user_level_rank(auth.uid()) >= 2)
with check (fn_user_level_rank(auth.uid()) >= 2);

create policy crm_clients_delete
on crm_clients for delete to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);
