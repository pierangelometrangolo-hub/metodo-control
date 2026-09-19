-- ============ FIX: guest_nationality leggibile da qualunque authenticated ============
-- GitHub issue #1. Scoperto durante l'audit "Security Definer Views"
-- (fix v_snapshot_latest e altre 4 view, vedi
-- supabase/migrations/20260812100000_fix_security_definer_views.sql),
-- testando v_nationality_latest.
--
-- guest_nationality ha una policy SELECT aperta a qualunque utente
-- authenticated, senza gate di livello (20260810090000_guest_nationality_rls.sql):
--
--   create policy guest_nationality_select_authenticated
--   on guest_nationality for select to authenticated using (true);
--
-- Le sue tabelle "sorelle" nel modulo Performance -
-- performance_daily_snapshot, channel_revenue, performance_monthly_snapshot -
-- sono state ristrette a senior/master (fn_user_level_rank(auth.uid()) >= 2)
-- nell'audit dell'11/08 (20260811140000_performance_daily_snapshot_level_gate.sql).
-- guest_nationality e' rimasta fuori da quel giro per svista, non per scelta
-- esplicita - la UI (drill-down struttura, "Presenze per nazionalita'") e'
-- comunque gated da canViewModule("performance") lato client, quindi il
-- dato era protetto solo dalla UI, non dalla RLS: stesso schema di rischio
-- gia' trovato e chiuso sulle tabelle sorelle. Verificato empiricamente
-- PRIMA di questa migration (account level="user" reale, chiave anon):
-- legge tutte le righe della tabella senza restrizioni.
--
-- INSERT resta invariata (guest_nationality_insert_senior_master, da
-- 20260813190000_guest_nationality_insert_rls.sql, gia' correttamente
-- gated) - qui si tocca solo SELECT.
drop policy guest_nationality_select_authenticated on guest_nationality;

create policy guest_nationality_select_senior_master
on guest_nationality
for select
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);
