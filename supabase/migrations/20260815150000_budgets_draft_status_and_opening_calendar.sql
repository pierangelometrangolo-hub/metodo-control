-- ============ Budget UI: stato 'draft' + calendario apertura per RN.AV ============
-- Da rivedere ed eseguire a mano da Pierangelo su Supabase SQL Editor -
-- NON eseguita in autonomia. Riscritta in forma idempotente (drop if
-- exists prima di ogni create) dopo il primo tentativo: il vincolo CHECK
-- esistente su budgets.status si chiama gia' esattamente
-- "budgets_status_check" (confermato dal messaggio di errore Postgres
-- 42710 sul primo giro, non piu' una ricerca dinamica per nome).

-- ============ PARTE A: nuovo stato 'draft' su budgets.status ============
-- Diagnostica PRIMA (facoltativa, solo per conferma visiva):
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.budgets'::regclass and contype = 'c';
--   select status, count(*) from budgets group by status;

alter table public.budgets drop constraint if exists budgets_status_check;

alter table public.budgets
  add constraint budgets_status_check
  check (status in ('draft', 'pending', 'confirmed', 'rejected'));

-- Diagnostica DOPO (obbligatoria, verificare che il conteggio per status
-- coincida esattamente con quello di prima - nessun budget esistente deve
-- aver cambiato stato):
--   select status, count(*) from budgets group by status;
--   -- atteso: stessi conteggi di prima (183 righe, tutte 'confirmed',
--   -- verificato via API prima di scrivere questo file).

-- ============ PARTE B: calendario apertura per il calcolo di RN.AV ============
-- RN.AV proposto = n_rooms (structures) x giorni di apertura nel mese.
-- Nessuna riga per default (tutti i giorni del mese, calcolato lato
-- client dal calendario) - una riga qui esiste SOLO per registrare una
-- chiusura pianificata nota in fase di budget (es. ristrutturazione,
-- stagionalita' strutturale), mai per rispecchiare dati BD (BD non ha
-- export per anni futuri, e le OOO impreviste durante l'anno si vedono
-- gia' nel confronto Budget vs Actual via l'import ADR/RevPAR esistente,
-- senza toccare il budget confermato).
--
-- Nota: dai dati 2026 gia' importati, Palazzo Rollo mostra un pattern di
-- apertura graduale reale (media camere disponibili: Gen 5.2, Feb 5.1,
-- Mar 8.6, poi piena da Aprile, su 16 camere totali) - un candidato
-- concreto per una riga qui quando si pianifica il budget 2027. Dimora De
-- Belli (Gen-Mag 2026 a zero) rispecchia la nuova apertura 2026 gia'
-- nota, non serve una riga per gli anni successivi se aperta tutto
-- l'anno. Nessun'altra struttura mostra un pattern stagionale nei dati
-- attuali - da confermare comunque prima di popolare righe reali.
create table if not exists public.structure_opening_calendar (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures(id),
  season_year int not null,
  month int not null check (month between 1 and 12),
  days_open int not null check (days_open >= 0 and days_open <= 31),
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop index if exists public.idx_structure_opening_calendar_unique;
create unique index idx_structure_opening_calendar_unique
  on public.structure_opening_calendar(structure_id, season_year, month);

drop trigger if exists trg_structure_opening_calendar_updated_at on public.structure_opening_calendar;
create trigger trg_structure_opening_calendar_updated_at
before update on public.structure_opening_calendar
for each row
execute function public.set_updated_at();

-- ============ RLS ============
-- Stessa soglia di scrittura di budgets (fn_user_level_rank >= 2,
-- senior/master) - mai un riferimento diretto a profiles.level. Lettura
-- aperta a chiunque veda il modulo Performance (coerente con budgets,
-- select_authenticated).
alter table public.structure_opening_calendar enable row level security;

drop policy if exists structure_opening_calendar_select_authenticated on public.structure_opening_calendar;
create policy structure_opening_calendar_select_authenticated
on public.structure_opening_calendar for select
to authenticated
using (true);

drop policy if exists structure_opening_calendar_insert_senior_master on public.structure_opening_calendar;
create policy structure_opening_calendar_insert_senior_master
on public.structure_opening_calendar for insert
to authenticated
with check (fn_user_level_rank(auth.uid()) >= 2);

drop policy if exists structure_opening_calendar_update_senior_master on public.structure_opening_calendar;
create policy structure_opening_calendar_update_senior_master
on public.structure_opening_calendar for update
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2)
with check (fn_user_level_rank(auth.uid()) >= 2);

drop policy if exists structure_opening_calendar_delete_senior_master on public.structure_opening_calendar;
create policy structure_opening_calendar_delete_senior_master
on public.structure_opening_calendar for delete
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);
