-- ============ FIX: 5 view SECURITY DEFINER bypassavano la RLS ============
-- Il linter di sicurezza Supabase segnalava 5 view create senza
-- security_invoker (comportamento equivalente a SECURITY DEFINER per le
-- view: girano con i privilegi del proprietario, non di chi le
-- interroga). Verificato con pg_get_viewdef che nessuna delle 5 contiene
-- un filtro di permesso esplicito al suo interno (nessuna chiamata a
-- fn_user_level_rank/fn_user_can_view_module/auth.uid()) - sono tutte
-- semplici DISTINCT ON di deduplica o join di arricchimento, mai pensate
-- per bypassare la RLS.
--
-- Rischio verificato empiricamente (utente reale di livello 'user',
-- autenticato con la sola chiave anon pubblica, prima del fix):
--   - v_snapshot_latest: 5.134 righe di dati economici (revenue, camere
--     vendute/disponibili, arrivi, presenze) leggibili nonostante la RLS
--     su performance_daily_snapshot/performance_monthly_snapshot
--     richieda fn_user_level_rank(auth.uid()) >= 2 (senior/master) -
--     query diretta sulle stesse tabelle, stesso utente: 0 righe. La view
--     annullava silenziosamente il gate di livello introdotto
--     nell'audit di sicurezza dell'11/08 (performance_daily_snapshot_
--     level_gate). Bypass reale e attivo, non solo teorico.
--   - v_budgets_current, v_nationality_latest, v_subtasks_detailed,
--     v_subtasks_time_analysis: nessuna esposizione aggiuntiva rispetto
--     alle tabelle sottostanti (che permettono gia' lo stesso accesso a
--     qualunque utente autenticato, per scelta gia' presa altrove) - il
--     fix qui e' igiene/coerenza, non chiusura di un buco attivo.
--
-- Fix: security_invoker = true (Postgres 15+, supportato da Supabase) fa
-- si' che ciascuna view applichi la RLS di chi la interroga invece di
-- quella del proprietario. Stessa identica logica SQL della view, cambia
-- solo chi viene controllato dalla RLS delle tabelle sottostanti - nessun
-- comportamento diverso per gli utenti gia' autorizzati (verificato con
-- un account senior reale dopo il fix: Dashboard, Strutture e drill-down
-- continuano a mostrare gli stessi dati di prima).
--
-- Gia' eseguito manualmente in Supabase SQL Editor e verificato (ritest
-- empirico: v_snapshot_latest torna 0 righe per un utente 'user', le
-- altre 4 invariate) - questa migration ne traccia lo storico nel repo.

alter view public.v_budgets_current set (security_invoker = true);
alter view public.v_nationality_latest set (security_invoker = true);
alter view public.v_snapshot_latest set (security_invoker = true);
alter view public.v_subtasks_detailed set (security_invoker = true);
alter view public.v_subtasks_time_analysis set (security_invoker = true);
