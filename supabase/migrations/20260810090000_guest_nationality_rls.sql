-- ============ FIX: RLS abilitata senza policy su guest_nationality ============
-- Stesso schema di problema gia' diagnosticato piu' volte in questo modulo
-- (structures, bd_imports, performance_daily_snapshot, channel_revenue):
-- RLS abilitata ma zero policy, quindi ogni SELECT lato client autenticato
-- torna 0 righe silenziosamente. Verificato con un utente autenticato
-- reale di livello 'senior' prima di scrivere qualunque UI.
--
-- Solo SELECT: nessuna scrittura da app su questa tabella (popolata via
-- import esterno), coerente con l'accesso in sola lettura richiesto dalla
-- sezione "Presenze per nazionalita'" nel drill-down struttura.

create policy guest_nationality_select_authenticated
on guest_nationality
for select
to authenticated
using (true);
