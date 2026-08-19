-- ============ PROPOSTA — NON ESEGUIRE — Pickup mensile: elenco estrazioni disponibili ============
-- Supporto al pickup mensile reale (vista Mensile, drill-down struttura).
-- Dal fix sulla semantica canonica (20260817110000_fix_fn_month_snapshot_asof_daily_priority.sql)
-- la vista Mensile aveva perso il pickup: fn_month_snapshot_asof restituisce
-- un solo punto nel tempo per cutoff, senza concetto di "estrazione
-- precedente". Il pickup si ricostruisce SOPRA fn_month_snapshot_asof, con
-- due chiamate a cutoff diversi (ultima e penultima estrazione) - questa
-- funzione serve solo a scoprire quali extraction_date sono disponibili per
-- una struttura, fn_month_snapshot_asof stessa NON viene toccata.
--
-- Unifica performance_daily_snapshot e performance_monthly_snapshot come
-- fonte di extraction_date (UNION, non UNION ALL: dedup automatico anche
-- se la stessa data compare in entrambe le tabelle) - coerente con
-- fn_month_snapshot_asof che ormai attinge da entrambe con la stessa
-- semantica canonica. Una struttura con dati solo su una delle due tabelle
-- deve comunque restituire il proprio elenco senza errori (verificato nella
-- diagnostica sotto).
create or replace function fn_available_extractions(p_structure_id uuid)
returns table (extraction_date date)
language sql
stable
as $$
  select extraction_date from performance_daily_snapshot where structure_id = p_structure_id
  union
  select extraction_date from performance_monthly_snapshot where structure_id = p_structure_id
  order by extraction_date desc;
$$;

-- ============ Diagnostica post-migration ============

-- 1) Struttura con storico daily multi-estrazione (Arco Cadura): piu' di
-- una riga, ordine decrescente.
select * from fn_available_extractions('045d1664-3ea0-4414-a4d5-e611c42f73de') limit 5;

-- 2) Montecallini: deve funzionare senza errori qualunque sia la sua fonte
-- reale tra le due tabelle.
select * from fn_available_extractions('e627e0f4-b7ca-42b2-9c72-d4470db6f708') limit 5;

-- 3) Struttura inesistente/senza alcun dato: zero righe, mai un errore.
select count(*) as righe_attese_zero from fn_available_extractions('00000000-0000-0000-0000-000000000000');
