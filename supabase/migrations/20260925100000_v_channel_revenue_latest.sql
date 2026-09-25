-- ============ v_channel_revenue_latest: dedup per extraction_date ============
-- channel_revenue salva una riga NUOVA per ogni re-import (come
-- performance_daily_snapshot e guest_nationality), non fa upsert: una
-- struttura re-importata acquisisce piu' extraction_date per la stessa
-- chiave logica (structure_id, period_start, channel). Il dettaglio
-- struttura sommava finora TUTTE le righe indipendentemente dalla
-- extraction_date, raddoppiando i totali del widget "Revenue per canale"
-- non appena una seconda estrazione veniva caricata (bug riprodotto e
-- documentato empiricamente su Palazzo Rollo/Villa Neviera/Palazzo Arco
-- Cadura/Dimora De Belli il 2026-09-24).
--
-- Diagnostica pre-migration (chiave completa structure_id/period_start/
-- channel/extraction_date): 0 righe duplicate su 9.517 totali - nessuna
-- ambiguita' da risolvere, la extraction_date e' sempre stata scritta una
-- sola volta per chiave logica ad ogni import.
--
-- Stesso pattern gia' in uso per performance_daily_snapshot
-- (v_snapshot_latest, vedi 20260810120000_fn_snapshot_asof.sql) e per
-- guest_nationality (v_nationality_latest, vedi
-- 20260812100000_fix_security_definer_views.sql): DISTINCT ON sulla
-- chiave logica, ordinata per extraction_date DESC. created_at DESC e id
-- DESC sono solo un tie-break deterministico per l'ipotesi (mai osservata
-- finora) di due righe con la STESSA extraction_date sulla stessa chiave.
create view public.v_channel_revenue_latest as
select distinct on (structure_id, period_start, channel)
  id,
  structure_id,
  period_start,
  period_end,
  extraction_date,
  channel,
  revenue_gross,
  commission_pct,
  bd_import_id,
  created_at
from public.channel_revenue
order by
  structure_id,
  period_start,
  channel,
  extraction_date desc,
  created_at desc,
  id desc;

-- Stessa identica misura di sicurezza di v_snapshot_latest/
-- v_nationality_latest (20260812100000_fix_security_definer_views.sql):
-- senza security_invoker una view gira con i privilegi del proprietario
-- (equivalente a SECURITY DEFINER), bypassando silenziosamente la RLS di
-- channel_revenue per chi la interroga. Nessun modello di sicurezza nuovo:
-- solo la stessa DISTINCT ON di deduplica, senza filtro di permesso
-- proprio - la RLS resta quella della tabella sottostante, applicata a chi
-- fa la query grazie a security_invoker.
alter view public.v_channel_revenue_latest set (security_invoker = true);
