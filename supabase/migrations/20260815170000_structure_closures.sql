-- ============ Chiusure struttura (calendario apertura/chiusura per il Budget) ============
-- Registro delle chiusure pianificate per struttura, dichiarate a mano da
-- senior/master (mai derivate da BD - BD non ha export per anni futuri e
-- non e' comunque la fonte di verita' per le chiusure pianificate, solo
-- per il consuntivo/OTB gia' coperto dall'import ADR/RevPAR esistente).
--
-- E' il registro sorgente (con date reali e nota facoltativa) da cui si
-- ricalcolano i "giorni di apertura nel mese" gia' salvati in
-- structure_opening_calendar (tabella creata da
-- 20260815150000_budgets_draft_status_and_opening_calendar.sql), che resta
-- la cache aggregata per mese usata dal calcolo automatico di RN.AV - il
-- codice che legge structure_opening_calendar non cambia.
--
-- Nessun UPDATE: le chiusure sono voci di log immutabili, per correggere
-- un errore si cancella e si re-inserisce (piu' semplice, ed evita di
-- dover ridisegnare la UI per un editing in-place di un range di date).

create table if not exists public.structure_closures (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures(id),
  start_date date not null,
  end_date date not null,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint structure_closures_valid_range check (end_date >= start_date)
);

create index if not exists idx_structure_closures_structure
  on public.structure_closures(structure_id, start_date);

alter table public.structure_closures enable row level security;

drop policy if exists structure_closures_select_authenticated on public.structure_closures;
create policy structure_closures_select_authenticated
on public.structure_closures
for select
to authenticated
using (true);

-- Stessa soglia di scrittura di budgets/structure_opening_calendar
-- (fn_user_level_rank >= 2, senior/master) - mai riferimento diretto a
-- profiles.level.
drop policy if exists structure_closures_insert_senior_master on public.structure_closures;
create policy structure_closures_insert_senior_master
on public.structure_closures
for insert
to authenticated
with check (fn_user_level_rank(auth.uid()) >= 2);

drop policy if exists structure_closures_delete_senior_master on public.structure_closures;
create policy structure_closures_delete_senior_master
on public.structure_closures
for delete
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);

-- Diagnostica post-migration: deve restituire 4 righe (tabella + 3 policy).
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'structure_closures') as tabella_creata,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'structure_closures') as policy_create;
