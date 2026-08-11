-- La Dashboard (vista d'insieme) deve mostrare, per OGNI struttura, la data
-- dell'ultima estrazione che alimenta Revenue OTB/ADR/RevPAR/Occupazione
-- (performance_daily_snapshot + performance_monthly_snapshot) - stessa
-- informazione gia' presente nel drill-down struttura, ma li' calcolata con
-- due query separate per una singola struttura alla volta. Serve una
-- funzione che restituisca il MAX(extraction_date) per struttura, in una
-- sola chiamata per tutte le strutture della vista d'insieme (PostgREST non
-- supporta GROUP BY lato client).
create or replace function fn_latest_extraction_per_structure(p_structure_ids uuid[])
returns table (
  structure_id uuid,
  extraction_date date
)
language sql
stable
as $$
  select structure_id, max(extraction_date) as extraction_date
  from (
    select structure_id, extraction_date
    from performance_daily_snapshot
    where structure_id = any(p_structure_ids)
    union all
    select structure_id, extraction_date
    from performance_monthly_snapshot
    where structure_id = any(p_structure_ids)
  ) combined
  group by structure_id;
$$;
