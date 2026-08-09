-- ============ FIX: RLS abilitata senza policy su channel_revenue ============
-- Stesso schema di problema gia' diagnosticato piu' volte in questo modulo
-- (modules, macro_areas, structures, bd_imports, performance_daily_snapshot):
-- RLS abilitata ma zero policy, quindi ogni SELECT lato client autenticato
-- torna 0 righe silenziosamente. Verificato con un utente autenticato
-- reale di livello 'senior' prima di scrivere qualunque UI.
--
-- Solo SELECT: nessuna scrittura da app su questa tabella (popolata via
-- script SQL manuale), coerente con l'accesso in sola lettura richiesto
-- dalla sezione "Revenue per canale" nel drill-down struttura.

create policy channel_revenue_select_authenticated
on channel_revenue
for select
to authenticated
using (true);
