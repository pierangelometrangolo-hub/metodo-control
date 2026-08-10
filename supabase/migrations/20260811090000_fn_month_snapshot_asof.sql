-- Il confronto SDLY mensile della Dashboard (fn_snapshot_asof, migration
-- 20260810120000) legge solo performance_daily_snapshot. Ma lo storico 2025
-- caricato dai 207 file "storico_sdly" (report ADR-RevPAR settimanale) e'
-- stato salvato con granularita' MENSILE in performance_monthly_snapshot
-- (una riga per structure_id/period_year/period_month/extraction_date), non
-- in performance_daily_snapshot. Risultato: per i mesi 2025 la colonna SDLY
-- risultava "ND" nonostante i dati esistessero, semplicemente nel posto
-- sbagliato per quella funzione.
--
-- fn_month_snapshot_asof e' una funzione dedicata, separata da
-- fn_snapshot_asof (che resta invariata e continua a servire solo il
-- livello giornaliero: pickup, medie giornaliere, ecc. - la vista mensile
-- di performance_monthly_snapshot non deve mai comparire li').
--
-- Per un dato structure_id/mese/cutoff:
--   1. se performance_monthly_snapshot ha una riga con extraction_date <=
--      cutoff, quella riga vince sempre: e' un aggregato mensile gia'
--      completo, pensato apposta per questo confronto, non un'
--      approssimazione (verificato: le due fonti non si sovrappongono mai
--      sugli stessi cutoff nei dati attuali, ma la priorita' resta esplicita
--      per il futuro).
--   2. altrimenti, se performance_daily_snapshot ha almeno un giorno del
--      mese con extraction_date <= cutoff, si usa la somma di quei giorni
--      (stessa logica "ultimo per stay_date entro il cutoff" di
--      fn_snapshot_asof).
--   3. altrimenti nessuna riga per quella struttura: la Dashboard mostra ND.
create or replace function fn_month_snapshot_asof(
  p_structure_ids uuid[],
  p_period_year int,
  p_period_month int,
  p_cutoff_date date
)
returns table (
  structure_id uuid,
  revenue_total numeric,
  rooms_sold numeric,
  rooms_available numeric,
  arrivals numeric,
  presences numeric,
  source text
)
language sql
stable
as $$
  with bounds as (
    select
      make_date(p_period_year, p_period_month, 1) as month_start,
      (make_date(p_period_year, p_period_month, 1) + interval '1 month' - interval '1 day')::date as month_end
  ),
  monthly_row as (
    select distinct on (pms.structure_id)
      pms.structure_id,
      pms.revenue_total,
      pms.rooms_sold,
      pms.rooms_available,
      pms.arrivals,
      pms.presences
    from performance_monthly_snapshot pms
    where pms.structure_id = any(p_structure_ids)
      and pms.period_year = p_period_year
      and pms.period_month = p_period_month
      and pms.extraction_date <= p_cutoff_date
    order by pms.structure_id, pms.extraction_date desc
  ),
  daily_latest as (
    select distinct on (pds.structure_id, pds.stay_date)
      pds.structure_id,
      pds.stay_date,
      pds.revenue_total,
      pds.rooms_sold,
      pds.rooms_available,
      pds.arrivals,
      pds.presences
    from performance_daily_snapshot pds, bounds
    where pds.structure_id = any(p_structure_ids)
      and pds.stay_date between bounds.month_start and bounds.month_end
      and pds.extraction_date <= p_cutoff_date
    order by pds.structure_id, pds.stay_date, pds.extraction_date desc
  ),
  daily_sum as (
    select
      structure_id,
      sum(revenue_total) as revenue_total,
      sum(rooms_sold) as rooms_sold,
      sum(rooms_available) as rooms_available,
      sum(arrivals) as arrivals,
      sum(presences) as presences
    from daily_latest
    group by structure_id
  )
  select
    s.structure_id,
    coalesce(m.revenue_total, d.revenue_total) as revenue_total,
    coalesce(m.rooms_sold, d.rooms_sold) as rooms_sold,
    coalesce(m.rooms_available, d.rooms_available) as rooms_available,
    coalesce(m.arrivals, d.arrivals) as arrivals,
    coalesce(m.presences, d.presences) as presences,
    case when m.structure_id is not null then 'monthly' else 'daily' end as source
  from unnest(p_structure_ids) as s(structure_id)
  left join monthly_row m on m.structure_id = s.structure_id
  left join daily_sum d on d.structure_id = s.structure_id
  where m.structure_id is not null or d.structure_id is not null;
$$;
