-- ============ FIX: RLS abilitata senza policy su structures/bd_imports/performance_daily_snapshot ============
-- Stesso schema di problema già diagnosticato su modules/macro_areas/
-- macro_area_min_level/user_level_rank (vedi 20260808120400): queste tre
-- tabelle del modulo Performance hanno RLS abilitata ma zero policy,
-- quindi ogni SELECT/INSERT lato client fallisce (silenziosamente per
-- SELECT, con errore "row-level security policy" per INSERT). Verificato
-- prima di scrivere qualunque UI, con un utente autenticato reale di
-- livello 'user'.
--
-- Modello di visibilità: coerente con tasks/tracking già esistenti in
-- app (qualunque utente autenticato vede tutto, la restrizione è solo
-- sul menu/modulo tramite fn_user_can_view_module, non sulle righe).
-- Nessun UPDATE/DELETE concesso in questa fase: coerente con "nessuna
-- cancellazione/modifica dei dati già salvati" richiesto per il V0.

create policy structures_select_authenticated
on structures
for select
to authenticated
using (true);

create policy bd_imports_select_authenticated
on bd_imports
for select
to authenticated
using (true);

create policy bd_imports_insert_authenticated
on bd_imports
for insert
to authenticated
with check (true);

create policy performance_daily_snapshot_select_authenticated
on performance_daily_snapshot
for select
to authenticated
using (true);

create policy performance_daily_snapshot_insert_authenticated
on performance_daily_snapshot
for insert
to authenticated
with check (true);
