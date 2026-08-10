-- ============ FIX: clients scrivibile/cancellabile da qualunque utente autenticato ============
-- Audit sicurezza 2026-08-11: l'unica policy su clients era "Allow all for
-- authenticated users" (cmd ALL, qual/with_check = auth.role() =
-- 'authenticated'). Qualunque utente loggato, a prescindere dal livello,
-- poteva leggere MA ANCHE inserire/modificare/cancellare qualunque cliente.
--
-- Verificato nel codice: l'app oggi legge SOLO clients (id, name, status)
-- in tre punti (dashboard, operations, time-tracking) per popolare menu a
-- tendina - nessuna funzionalita' esistente scrive su questa tabella dal
-- client, quindi restringere le scritture non rompe nulla di gia' in uso.
--
-- Le scritture vengono ora gatekeeper per livello (>=2, senior/master),
-- stesso schema gia' in uso per budgets (budgets_insert_senior_master /
-- budgets_update_senior_master) - clients e' dato anagrafico/di business
-- gestionale, non dato personale dell'utente (a differenza di tracking, che
-- ha un proprietario naturale in operatore_id), quindi un gate per livello
-- e' la scelta piu' coerente con le convenzioni gia' presenti nello schema.
-- La lettura resta aperta a qualunque utente autenticato, come oggi.
drop policy "Allow all for authenticated users" on clients;

create policy clients_select_authenticated
on clients
for select
to authenticated
using (true);

create policy clients_insert_senior_master
on clients
for insert
to authenticated
with check (fn_user_level_rank(auth.uid()) >= 2);

create policy clients_update_senior_master
on clients
for update
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);

create policy clients_delete_senior_master
on clients
for delete
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);
