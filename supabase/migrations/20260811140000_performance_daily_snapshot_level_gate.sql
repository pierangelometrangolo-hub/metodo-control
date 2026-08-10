-- ============ FIX: dati economici Performance leggibili da qualunque authenticated ============
-- Audit sicurezza 2026-08-11: la policy UPDATE su performance_daily_snapshot
-- (snapshot_update_senior_master, gia' esistente) richiede correttamente
-- fn_user_level_rank(auth.uid()) >= 2, ma SELECT e INSERT erano aperte a
-- "to authenticated using/with check (true)" senza alcun controllo di
-- livello - stessa asimmetria scrittura-protetta/lettura-aperta trovata su
-- budgets. Verificato empiricamente in sessione precedente: un account
-- level=user (che fn_user_can_view_module('performance') esclude dalla UI)
-- poteva comunque leggere tutte le 6.959 righe via API diretta.
--
-- Stessa identica lacuna su channel_revenue e performance_monthly_snapshot
-- (create in sessioni precedenti con solo una policy SELECT authenticated,
-- true, nessun gate di livello). Controllato: nessuna delle due ha policy
-- INSERT/UPDATE/DELETE gia' esistenti (scrivibili solo da service role,
-- coerente con come sono state popolate) - qui serve gatekeeper solo il
-- SELECT, non c'e' nessuna scrittura authenticated da restringere.
--
-- Fix: SELECT (e INSERT dove gia' apribile ad authenticated) allineate allo
-- stesso gate gia' in uso per UPDATE su performance_daily_snapshot e per le
-- scritture di budgets (fn_user_level_rank >= 2, senior/master) - stessa
-- convenzione, non una nuova regola.
drop policy performance_daily_snapshot_select_authenticated on performance_daily_snapshot;
drop policy performance_daily_snapshot_insert_authenticated on performance_daily_snapshot;

create policy performance_daily_snapshot_select_senior_master
on performance_daily_snapshot
for select
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);

create policy performance_daily_snapshot_insert_senior_master
on performance_daily_snapshot
for insert
to authenticated
with check (fn_user_level_rank(auth.uid()) >= 2);

drop policy channel_revenue_select_authenticated on channel_revenue;

create policy channel_revenue_select_senior_master
on channel_revenue
for select
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);

drop policy performance_monthly_snapshot_select_authenticated on performance_monthly_snapshot;

create policy performance_monthly_snapshot_select_senior_master
on performance_monthly_snapshot
for select
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);
