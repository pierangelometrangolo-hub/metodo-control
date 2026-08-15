-- ============ FIX: la policy UPDATE su budgets blocca i senior (rank 2) ============
-- Scoperto durante il test empirico della nuova UI Budget: un utente senior
-- (fn_user_level_rank = 2, verificato via RPC) non riesce ad aggiornare
-- NESSUNA riga di budgets, nemmeno una propria riga in stato 'draft' e
-- nemmeno cambiando un solo campo (adr) senza toccare lo status. La UPDATE
-- ritorna 0 righe modificate e error: null (blocco silenzioso RLS, USING
-- clause che esclude la riga dal set aggiornabile).
--
-- Stesso identico test con un utente master: la UPDATE va a buon fine.
--
-- Questo contraddice i commenti gia' presenti nel repo (vedi
-- 20260811120000_clients_restrict_writes_by_level.sql e
-- 20260811140000_performance_daily_snapshot_level_gate.sql), che indicano
-- "budgets_update_senior_master" come policy con soglia rank >= 2 (senior
-- incluso) - la policy attualmente installata in produzione non rispetta
-- quel nome/quella soglia dichiarata.
--
-- Impatto pratico: con la nuova UI di inserimento budget, il flusso "Salva
-- bozza" (che al secondo salvataggio fa UPDATE sulla riga draft gia'
-- esistente) e "Sottometti per revisione" (UPDATE status draft -> pending)
-- risultavano bloccati per i senior senza alcun errore visibile - la UI
-- mostrava "salvato con successo" ma nel database non cambiava nulla.
--
-- Diagnostica PRE-fix (facoltativa, solo lettura) - puoi eseguirla prima per
-- vedere la situazione attuale delle policy UPDATE su budgets:
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'budgets' and cmd = 'UPDATE';
--
-- Fix: rimuove qualunque policy UPDATE attualmente presente su public.budgets
-- (qualunque sia il suo nome esatto - non lo diamo per scontato) e la
-- ricrea con la soglia rank >= 2, identica a quella gia' in uso per INSERT
-- su questa stessa tabella.

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'budgets' and cmd = 'UPDATE'
  loop
    execute format('drop policy %I on public.budgets', pol.policyname);
  end loop;
end $$;

create policy budgets_update_senior_master
on public.budgets
for update
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2)
with check (fn_user_level_rank(auth.uid()) >= 2);

-- Diagnostica POST-fix: deve restituire esattamente 1 riga, con qual e
-- with_check contenenti "fn_user_level_rank(auth.uid()) >= 2".
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'budgets' and cmd = 'UPDATE';
