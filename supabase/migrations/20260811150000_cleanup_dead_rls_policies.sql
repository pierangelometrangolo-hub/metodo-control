-- ============ PULIZIA: policy RLS duplicate/morte (nessun cambio di comportamento) ============
-- Audit sicurezza 2026-08-11: alcune tabelle hanno una policy PERMISSIVE
-- ampia ("true", qualunque authenticated) che convive con una policy piu'
-- stretta pre-esistente sulla stessa tabella/comando. Essendo entrambe
-- PERMISSIVE, l'accesso finale e' l'OR delle due: la piu' ampia vince
-- sempre, rendendo la piu' stretta morta (non cambia mai il risultato,
-- toglierla non modifica alcun comportamento reale).
--
-- Pattern riconoscibile: sembra il residuo di come sono stati risolti in
-- passato i bug "RLS attiva senza policy" in questo progetto - si aggiungeva
-- una policy permissiva per sbloccare subito l'accesso, senza rimuovere
-- l'originale piu' restrittiva. Questa migration rimuove solo le policy
-- morte, per chiarezza (una sola regola leggibile per tabella/comando),
-- senza toccare quella realmente in vigore.

-- profiles: profiles_select_authenticated (true) rende morta
-- profiles_select_own (auth.uid() = id).
drop policy profiles_select_own on profiles;

-- profiles: profiles_update_own e profiles_update_own_record sono
-- IDENTICHE (stesso qual/with_check auth.uid() = id) - pura duplicazione,
-- si tiene la prima.
drop policy profiles_update_own_record on profiles;

-- tasks: authenticated_can_read_all_tasks (true) rende morta
-- tasks_select_involved (owner/creator/closed_by) - coerente con come
-- Operations legge le task oggi (nessun filtro per utente).
drop policy tasks_select_involved on tasks;

-- tracking_history: tracking_history_select_authenticated (true) rende
-- morta tracking_history_select_own (via join su tracking.operatore_id).
drop policy tracking_history_select_own on tracking_history;
