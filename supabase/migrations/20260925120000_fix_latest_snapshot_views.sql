-- ============ Fix semantica v_channel_revenue_latest + v_nationality_latest ============
-- Entrambe le view (20260925100000_v_channel_revenue_latest.sql per i
-- canali, definizione storica per la nazionalita') usavano la semantica
-- "ultima riga per chiave logica": DISTINCT ON (structure_id, giorno,
-- canale|nazionalita') ORDER BY extraction_date DESC.
--
-- Semantica ERRATA per gli export Booking Designer attuali: ogni file e'
-- uno snapshot COMPLETO dell'anno solare ("Revenue per canale (01 Gen
-- 2026 - 31 Dic 2026)", "Ospiti per provenienza (01 Gen 2026 - 31 Dic
-- 2026)") e salva solo le righe non vuote. Se in una nuova estrazione una
-- chiave non compare piu' (es. prenotazione cancellata: quel canale non ha
-- piu' revenue quel giorno), la vecchia semantica faceva sopravvivere la
-- riga dell'estrazione precedente - carry-forward di dati superati.
-- Verificato sui dati reali 2026 (confronto con i file BD):
--   canali   Palazzo Rollo 497.240,25 invece di 491.362,24; Arco Cadura
--            191.708,58 / 191.148,23; Villa Neviera 161.112,85 /
--            159.439,43; Dimora De Belli 79.430,20 / 79.072,00
--   presenze Villa Neviera 2.881 invece di 2.803, Dimora De Belli 727 /
--            629, Sangiorgio 4.703 / 4.584, Rollo 5.354 / 5.338, Arco
--            Cadura 3.143 / 3.127
-- (Sangiorgio canali gia' corretto solo perche' ha una sola estrazione.)
--
-- Semantica corretta: per ogni (structure_id, anno del dato) si individua
-- MAX(extraction_date) e si restituiscono SOLO le righe di quella
-- estrazione. Nessun carry-forward da estrazioni precedenti.
--
-- Perche' per ANNO e non per struttura: gli import coprono un anno solare
-- ciascuno - l'estrazione 2026-09-24 contiene solo il 2026, mentre
-- 2023-2025 esistono solo nell'estrazione 2026-08-09. "Ultima estrazione
-- della struttura" cancellerebbe lo storico usato dal confronto con
-- l'anno precedente.
--
-- VINCOLO ARCHITETTURALE: questa logica e' corretta FINCHE' ogni import di
-- Revenue per canale / Nazionalita' e' uno snapshot completo dell'anno
-- solare. Un import parziale (mensile, stagionale, sub-annuale) con
-- extraction_date piu' recente nasconderebbe il resto dell'anno. Se in
-- futuro verranno supportati import parziali serve una dimensione
-- esplicita di coverage dell'import (es. coverage_start/coverage_end su
-- bd_imports) e una regola "ultima estrazione che copre quel giorno" -
-- NON basarsi solo sull'anno.
--
-- DISTINCT ON residuo: solo protezione deterministica contro duplicati
-- tecnici sulla STESSA extraction_date (diagnostica pre-migration: 0
-- duplicati su (structure_id, period_start, channel, extraction_date)),
-- mai carry-forward - il join su latest ha gia' escluso ogni altra
-- estrazione.
--
-- Colonne, ordine e tipi identici alle view esistenti (vincolo di CREATE
-- OR REPLACE VIEW): nessuna modifica richiesta lato applicazione.
-- security_invoker = true mantenuto (RLS di chi interroga, vedi
-- 20260812100000_fix_security_definer_views.sql): il CTE latest vede solo
-- le righe gia' permesse dalla RLS delle tabelle sottostanti.

create or replace view public.v_channel_revenue_latest
with (security_invoker = true) as
with latest as (
  select
    structure_id,
    extract(year from period_start)::int as data_year,
    max(extraction_date) as extraction_date
  from public.channel_revenue
  group by structure_id, extract(year from period_start)::int
)
select distinct on (cr.structure_id, cr.period_start, cr.channel)
  cr.id,
  cr.structure_id,
  cr.period_start,
  cr.period_end,
  cr.extraction_date,
  cr.channel,
  cr.revenue_gross,
  cr.commission_pct,
  cr.bd_import_id,
  cr.created_at
from public.channel_revenue cr
join latest l
  on l.structure_id = cr.structure_id
 and l.data_year = extract(year from cr.period_start)::int
 and l.extraction_date = cr.extraction_date
order by
  cr.structure_id,
  cr.period_start,
  cr.channel,
  cr.created_at desc,
  cr.id desc;

create or replace view public.v_nationality_latest
with (security_invoker = true) as
with latest as (
  select
    structure_id,
    extract(year from stay_date)::int as data_year,
    max(extraction_date) as extraction_date
  from public.guest_nationality
  group by structure_id, extract(year from stay_date)::int
)
select distinct on (gn.structure_id, gn.stay_date, gn.nationality)
  gn.id,
  gn.structure_id,
  gn.stay_date,
  gn.extraction_date,
  gn.nationality,
  gn.presences,
  gn.bd_import_id,
  gn.created_at
from public.guest_nationality gn
join latest l
  on l.structure_id = gn.structure_id
 and l.data_year = extract(year from gn.stay_date)::int
 and l.extraction_date = gn.extraction_date
order by
  gn.structure_id,
  gn.stay_date,
  gn.nationality,
  gn.created_at desc,
  gn.id desc;

-- Ridondante con la clausola WITH sopra, esplicito per chiarezza e per
-- allineamento con le migration precedenti.
alter view public.v_channel_revenue_latest set (security_invoker = true);
alter view public.v_nationality_latest set (security_invoker = true);
