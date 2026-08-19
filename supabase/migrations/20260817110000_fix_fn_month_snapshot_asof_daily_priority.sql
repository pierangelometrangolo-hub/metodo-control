-- ============ PROPOSTA — NON ESEGUIRE — Fix: fn_month_snapshot_asof deve preferire daily quando esiste ============
-- Causa esatta confermata leggendo la definizione originale
-- (20260811090000_fn_month_snapshot_asof.sql): monthly_row vince SEMPRE
-- quando esiste una riga con extraction_date <= cutoff, indipendentemente
-- dal fatto che daily esista ANCHE per lo stesso periodo con
-- un'estrazione piu' recente. Il commento originale lo anticipava
-- esplicitamente: "le due fonti non si sovrappongono mai sugli stessi
-- cutoff nei dati attuali, ma la priorita' resta esplicita per il
-- futuro" - quel "futuro" e' arrivato: correzioni daily successive non
-- sono mai state ripropagate al monthly.
--
-- Audit empirico completo (6 strutture, 2025-2026, 5 KPI ciascuno):
-- 73 periodi con divergenza reale, TUTTI con daily piu' recente del
-- monthly (zero controesempi) - nessun caso trovato dove monthly fosse
-- piu' fresco o dove i due divergessero per un motivo diverso dalla
-- mancata propagazione. Nessun periodo oggi esiste con SOLO monthly e
-- SENZA alcun daily per le 6 strutture attuali (verificato) - il
-- fallback su monthly resta comunque implementato per il caso
-- architetturale che lo giustifica (storico SDLY pre-backfill, strutture
-- senza PMS/BD) anche se oggi non si attiva mai nei dati reali.
--
-- Fix: stessa identica struttura di CTE, priorita' invertita nella SELECT
-- finale - daily vince se esiste, altrimenti monthly. Nessuna logica di
-- "freshness"/euristica: un controllo secco su esistenza, non su quale
-- estrazione sia piu' recente tra le due fonti.
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
    -- INVERTITO rispetto all'originale: daily prima, monthly solo come
    -- fallback quando daily non ha nessuna riga per il periodo/cutoff.
    coalesce(d.revenue_total, m.revenue_total) as revenue_total,
    coalesce(d.rooms_sold, m.rooms_sold) as rooms_sold,
    coalesce(d.rooms_available, m.rooms_available) as rooms_available,
    coalesce(d.arrivals, m.arrivals) as arrivals,
    coalesce(d.presences, m.presences) as presences,
    case when d.structure_id is not null then 'daily' else 'monthly' end as source
  from unnest(p_structure_ids) as s(structure_id)
  left join monthly_row m on m.structure_id = s.structure_id
  left join daily_sum d on d.structure_id = s.structure_id
  where m.structure_id is not null or d.structure_id is not null;
$$;

-- ============ Diagnostica post-migration — verifica i 7 casi richiesti ============

-- 1) Arco Cadura 2025: il totale annuale deve tornare a 187827.42 (dato
-- reale, non hardcoded qui - la RPC lo ricalcola dai dati esistenti).
select
  sum(revenue_total) as arco_cadura_2025_totale_atteso_187827_42
from (
  select (fn_month_snapshot_asof(
    array['045d1664-3ea0-4414-a4d5-e611c42f73de']::uuid[], 2025, m, current_date
  )).revenue_total
  from generate_series(1, 12) as m
) t;

-- 2) Dettaglio mensile 2025 Arco Cadura - conferma che ora tutti i mesi
-- (incluso settembre e dicembre, dove prima divergeva) usano source='daily'.
select m as mese, r.*
from generate_series(1, 12) as m,
lateral fn_month_snapshot_asof(array['045d1664-3ea0-4414-a4d5-e611c42f73de']::uuid[], 2025, m, current_date) r
order by m;

-- 3) Montecallini (nessun monthly esistente): deve continuare a
-- funzionare con source='daily', nessun errore.
select * from fn_month_snapshot_asof(array['e627e0f4-b7ca-42b2-9c72-d4470db6f708']::uuid[], 2025, 6, current_date);

-- 4) Periodo senza alcun dato (mese futuro oltre la copertura): deve
-- restituire zero righe, mai un errore.
select count(*) as righe_attese_zero from fn_month_snapshot_asof(array['045d1664-3ea0-4414-a4d5-e611c42f73de']::uuid[], 2030, 1, current_date);
