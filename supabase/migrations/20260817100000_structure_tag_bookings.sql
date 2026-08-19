-- ============ PROPOSTA — NON ESEGUIRE — Performance: TAG prenotazioni (Palazzo Rollo e future strutture) ============
-- Acquisisce e storicizza il dato TAG da Booking Designer (filtro
-- "Esportazione Prenotazioni" con Tag attivo) - Performance possiede gia'
-- Revenue, non TAG. Finance (Consulting Revenue Control, sviluppo
-- separato) former Revenue - TAG per Palazzo Rollo (calculation_basis
-- 'revenue_net_tag') leggendo da qui - nessuna logica Finance in questa
-- migration.
--
-- Modello A (tabella specifica), non EAV a metric_type - coerente con
-- channel_commission_rates/guest_nationality/channel_revenue, tutte
-- tabelle dedicate per metrica nel dominio Performance. structure_id
-- parametrico regge future strutture senza bisogno di genericita' sul
-- tipo di metrica.

create table public.structure_tag_bookings (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures(id),
  booking_code text not null,        -- "Cod." dal file BD, es. 3KO79N2449
  period_year int not null,
  period_month int not null check (period_month between 1 and 12),  -- mese di check-in, confermato: nessuno split proporzionale sui soggiorni a cavallo di due mesi
  tag_amount numeric not null,       -- "Totale Soggiorno" dal file BD
  check_in date not null,
  check_out date,
  source_reference text not null,    -- nome file/data export BD di provenienza
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint structure_tag_bookings_unique_booking unique (structure_id, booking_code)
);

create index idx_structure_tag_bookings_period on public.structure_tag_bookings(structure_id, period_year, period_month);

-- RLS + policy nella stessa migration di ENABLE (regola permanente del
-- progetto - un ENABLE ROW LEVEL SECURITY senza policy nella stessa
-- migration ha gia' causato un bug bloccante altrove in questa repo).
alter table public.structure_tag_bookings enable row level security;

create policy structure_tag_bookings_select_authenticated
on public.structure_tag_bookings
for select
to authenticated
using (true);

-- Stessa soglia di scrittura gia' in uso in tutto il modulo Performance
-- (fn_user_level_rank >= 2, senior/master) - mai riferimento diretto a
-- profiles.level.
create policy structure_tag_bookings_insert_senior_master
on public.structure_tag_bookings
for insert
to authenticated
with check (fn_user_level_rank(auth.uid()) >= 2);

create policy structure_tag_bookings_update_senior_master
on public.structure_tag_bookings
for update
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2)
with check (fn_user_level_rank(auth.uid()) >= 2);

-- ============ RPC: fn_tag_month_snapshot_asof ============
-- Semantica deliberatamente diversa da fn_snapshot_asof/
-- fn_month_snapshot_asof: TAG non e' un valore che cambia tra estrazioni
-- successive dello stesso periodo con priorita' daily/monthly, e' un
-- elenco di prenotazioni che si accumula nel tempo (nuove segnalazioni si
-- aggiungono, non sostituiscono un valore precedente) - nessun parametro
-- asof_date, nessuna logica di priorita' fonte.
create or replace function public.fn_tag_month_snapshot_asof(
  p_structure_id uuid,
  p_year int,
  p_month int
) returns numeric
language sql
stable
security invoker
as $$
  select coalesce(sum(tag_amount), 0)
  from public.structure_tag_bookings
  where structure_id = p_structure_id
    and period_year = p_year
    and period_month = p_month;
$$;

-- Diagnostica post-migration: deve dare 0 righe (tabella vuota, nessun
-- import ancora eseguito) e confermare che la RPC risponde con 0 su un
-- periodo senza dati (mai un errore su periodo vuoto).
select count(*) as righe_tag_bookings from public.structure_tag_bookings;
select public.fn_tag_month_snapshot_asof('9da73081-9e5f-4c0e-af7a-85408bed596b', 2025, 1) as tag_gennaio_2025_atteso_zero;
