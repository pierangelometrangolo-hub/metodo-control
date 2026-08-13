-- ============ Percentuali commissione per canale (Booking/Expedia/ecc.) ============
-- Schema confermato da Pierangelo. Sblocca il futuro Distribution Cost/Net
-- Revenue (feedback Alessandro) quando arriveranno le fatture 2025 - QUESTA
-- migration crea solo la tabella, nessun popolamento dati (le fatture 2025
-- non sono ancora disponibili, verificato: nessun file fatture/commissioni
-- in data/ - stesso principio di non stimare mai dati che non abbiamo).

create table channel_commission_rates (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references structures(id),
  channel text not null,
  period_year int not null,
  period_month int not null check (period_month between 1 and 12),
  commission_pct numeric not null,
  source text not null check (source in ('fattura', 'stima')),
  source_reference text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index idx_channel_commission_unique
  on channel_commission_rates(structure_id, channel, period_year, period_month);

-- ============ RLS ============
-- Non specificata nella richiesta originale, ma ogni altra tabella di
-- questo progetto ha RLS esplicita (audit sicurezza 2026-08-11/12) -
-- lasciarla senza policy qui sarebbe esattamente il tipo di lacuna che
-- quell'audit ha gia' trovato altrove. commission_pct e' dato economico
-- sensibile allo stesso titolo di channel_revenue, che ha gia' SELECT
-- ristretto a rank >= 2 (migration 20260811140000) - stessa soglia qui,
-- sia in lettura che in scrittura (dato di business gestionale, non
-- personale dell'utente, stesso ragionamento gia' fatto per clients).
alter table channel_commission_rates enable row level security;

create policy channel_commission_rates_select_senior_master
on channel_commission_rates for select
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);

create policy channel_commission_rates_insert_senior_master
on channel_commission_rates for insert
to authenticated
with check (fn_user_level_rank(auth.uid()) >= 2);

create policy channel_commission_rates_update_senior_master
on channel_commission_rates for update
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2)
with check (fn_user_level_rank(auth.uid()) >= 2);

create policy channel_commission_rates_delete_senior_master
on channel_commission_rates for delete
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);
