-- La Dashboard Performance (vista d'insieme) deve confrontare l'OTB del mese
-- corrente con l'OTB dello stesso mese dell'anno scorso "a parita' di
-- anticipo" (stesso numero di giorni prima della data di arrivo), non con il
-- consuntivo finale dell'anno scorso (quello e' gia' coperto dalla colonna
-- "Consuntivo anno prec. vs OTB", che resta invariata).
--
-- v_snapshot_latest prende, per ogni (structure_id, stay_date), la riga con
-- extraction_date piu' recente in assoluto: va bene per "adesso", ma non
-- permette di chiedere "qual era l'estrazione piu' recente disponibile ad
-- una certa data nel passato". fn_snapshot_asof aggiunge esattamente questo:
-- un cutoff esplicito su extraction_date al posto di "adesso" implicito.
--
-- Riusabile ovunque serva un confronto storico a parita' di anticipo (non
-- solo per la Dashboard): basta passare strutture, intervallo di stay_date
-- e cutoff.
create or replace function fn_snapshot_asof(
  p_structure_ids uuid[],
  p_stay_date_start date,
  p_stay_date_end date,
  p_cutoff_date date
)
returns table (
  structure_id uuid,
  stay_date date,
  revenue_total numeric,
  rooms_sold numeric,
  rooms_available numeric,
  arrivals numeric,
  presences numeric,
  extraction_date date
)
language sql
stable
as $$
  select distinct on (pds.structure_id, pds.stay_date)
    pds.structure_id,
    pds.stay_date,
    pds.revenue_total,
    pds.rooms_sold,
    pds.rooms_available,
    pds.arrivals,
    pds.presences,
    pds.extraction_date
  from performance_daily_snapshot pds
  where pds.structure_id = any(p_structure_ids)
    and pds.stay_date between p_stay_date_start and p_stay_date_end
    and pds.extraction_date <= p_cutoff_date
  order by pds.structure_id, pds.stay_date, pds.extraction_date desc;
$$;
