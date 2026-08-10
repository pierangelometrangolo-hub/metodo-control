-- ============ FIX: storage bd-import-files senza alcun controllo di livello ============
-- Audit sicurezza 2026-08-11: le policy su storage.objects per il bucket
-- "bd-import-files" controllavano solo bucket_id = 'bd-import-files',
-- senza alcun altro vincolo. Qualunque utente autenticato, a prescindere dal
-- livello, poteva leggere e caricare file per QUALUNQUE struttura (il path
-- {structureId}/{extractionDate}/... e' solo una convenzione di
-- organizzazione, non applicata da nessuna policy).
--
-- Non esiste nello schema alcun concetto di "struttura assegnata
-- all'utente" (verificato: nessuna tabella user_structure_access o simile,
-- nessun filtro per structure_id in nessuna policy di budgets/
-- channel_revenue/performance_daily_snapshot/performance_monthly_snapshot -
-- tutte quelle tabelle sono gia' leggibili per intero da qualunque
-- authenticated, senza segregazione per struttura). Restringere lo storage
-- per struttura sarebbe quindi un controllo nuovo e incoerente con come
-- funziona il resto del modulo Performance. Il fix coerente e' lo stesso
-- gia' usato altrove per i dati economici: gate per livello (>=2, senior/
-- master), non per struttura.
drop policy bd_import_files_select_authenticated on storage.objects;
drop policy bd_import_files_insert_authenticated on storage.objects;

create policy bd_import_files_select_senior_master
on storage.objects
for select
to authenticated
using (bucket_id = 'bd-import-files' and public.fn_user_level_rank(auth.uid()) >= 2);

create policy bd_import_files_insert_senior_master
on storage.objects
for insert
to authenticated
with check (bucket_id = 'bd-import-files' and public.fn_user_level_rank(auth.uid()) >= 2);
