-- ============ Storage RLS per il bucket bd-import-files ============
-- Il bucket "bd-import-files" (gia' creato via Storage API) contiene i
-- file Excel di export BD caricati con Import storico / Import actual,
-- referenziati da bd_imports.file_path per tracciabilita' (richiesto dal
-- vincolo chk_bd_imports_source_file quando source != 'manual').
--
-- Come per le altre tabelle di questo modulo, RLS su storage.objects e'
-- attiva di default in Supabase: senza policy nessuno (tranne service
-- role) puo' caricare o leggere file. Stesso modello di visibilita' gia'
-- in uso altrove: qualunque utente autenticato puo' caricare e leggere,
-- nessun update/delete concesso in questa fase.

create policy bd_import_files_insert_authenticated
on storage.objects
for insert
to authenticated
with check (bucket_id = 'bd-import-files');

create policy bd_import_files_select_authenticated
on storage.objects
for select
to authenticated
using (bucket_id = 'bd-import-files');
