-- ============ COMPLETAMENTO MODULO CRM ============
-- La migration 20260812110000_crm_module.sql si e' fermata a meta'
-- nell'esecuzione manuale su SQL Editor: enum, tabelle, indici, trigger
-- e la view sono stati creati correttamente (verificato via query sul
-- catalogo), ma modulo 'crm', level_module_access, tutte le policy RLS e
-- il security_invoker della view non sono mai stati applicati - risultato
-- verificato: RLS abilitata con zero policy su crm_clients/crm_contacts
-- (stesso bug "silenzioso" gia' visto su altre tabelle del progetto).
--
-- Questo file completa SOLO i pezzi mancanti (confermati via query di
-- sistema prima di scriverlo) - nessun create type/table/index/trigger/
-- view, che esistono gia' e darebbero errore "already exists".

-- ============ VIEW: security_invoker mancante ============
alter view v_crm_clients_badge set (security_invoker = true);

-- ============ MODULO "crm" NEL SISTEMA PERMESSI ============
insert into modules (key, name, sort_order) values
  ('crm', 'CRM', 7);

insert into level_module_access (level, module_id, can_view)
select l, m.id, true
from unnest(array['user','senior','master']::user_level[]) as l
join modules m on m.key = 'crm';

-- ============ RLS: policy mancanti ============
-- (RLS gia' abilitata su entrambe le tabelle, verificato - solo le
-- policy mancano)

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
