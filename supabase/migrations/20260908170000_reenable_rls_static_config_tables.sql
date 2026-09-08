-- ============ FIX (ri-applicato): RLS sulle 4 tabelle statiche di configurazione permessi ============
-- Tabelle: modules, macro_areas, macro_area_min_level, user_level_rank
--
-- CONTESTO / CAUSA DELLA "REGRESSIONE"
-- Il Supabase advisor segnala di nuovo (2026-09-06) "RLS disabled in public"
-- su queste 4 tabelle. NON e' una regressione da Table Editor e NON e' un
-- fix mai eseguito: e' esattamente lo stato creato DI PROPOSITO dalla
-- migration 20260808120400_fix_unintended_rls_static_tables.sql, che le aveva
-- DISABILITATE (erano finite con RLS attiva e zero policy -> modal "Moduli"
-- vuoto in /admin/utenti; all'epoca si scelse di spegnere la RLS trattandole
-- come dati di riferimento non sensibili).
--
-- Non esiste, e non e' mai esistita, una migration che ABILITA la RLS su
-- queste tabelle in questo repo: il "fix precedente" ricordato ERA il disable.
-- Una tabella in schema public con RLS disabilitata viene SEMPRE segnalata
-- dall'advisor `rls_disabled_in_public`: l'alert si sarebbe ripresentato a
-- ogni scansione finche' lo stato restava quello.
--   => e' un problema di DECISIONE, non di processo. Verificato empiricamente
--      il 2026-09-08 (client anon, nessun login): `modules` -> 7 righe,
--      `user_level_rank` -> 3 righe. La migration di agosto era stata
--      effettivamente eseguita su Supabase; e' quella scelta a generare per
--      definizione il warning.
--
-- DECISIONE CORRENTE (supera quella di agosto)
-- RLS attiva su tutte e 4 + una policy SELECT permissiva "to authenticated".
-- Questo silenzia l'advisor E non ripropone il bug del modal vuoto: l'unica
-- lettura diretta lato client (solo /admin/utenti, solo master, legge
-- `modules`) passa perche' ora esiste una policy esplicita, non
-- RLS-senza-policy. Le altre 3 tabelle non hanno letture dirette dal frontend
-- (usate solo dentro fn_user_level_rank / fn_user_can_view_module, security
-- definer, che bypassano comunque la RLS).
-- Nessuna scrittura dal frontend: nessuna policy INSERT/UPDATE/DELETE (la
-- gestione resta via service role / SQL Editor).
--
-- Verifica: scripts/rls-static-config-tables-audit.ts

alter table modules              enable row level security;
alter table macro_areas          enable row level security;
alter table macro_area_min_level enable row level security;
alter table user_level_rank      enable row level security;

drop policy if exists modules_select_authenticated              on modules;
drop policy if exists macro_areas_select_authenticated          on macro_areas;
drop policy if exists macro_area_min_level_select_authenticated on macro_area_min_level;
drop policy if exists user_level_rank_select_authenticated      on user_level_rank;

create policy modules_select_authenticated
  on modules for select to authenticated using (true);

create policy macro_areas_select_authenticated
  on macro_areas for select to authenticated using (true);

create policy macro_area_min_level_select_authenticated
  on macro_area_min_level for select to authenticated using (true);

create policy user_level_rank_select_authenticated
  on user_level_rank for select to authenticated using (true);
