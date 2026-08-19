-- ============ PROPOSTA — NON ESEGUIRE — consulting_fee_rules → counterparty_id ============
-- Dipende da 20260816100000_finance_core_counterparties.sql (le 6
-- counterparty delle strutture attive devono gia' esistere per il
-- backfill sotto).
--
-- Sostituisce l'idea precedente (crm_client_id diretto su
-- consulting_fee_rules) con counterparty_id, per non legare Finance
-- direttamente al modello CRM corrente - da counterparty si arriva
-- comunque a crm_client/structure quando esistono, tramite
-- counterparties.crm_client_id / counterparties.structure_id.

alter table public.consulting_fee_rules
  add column if not exists counterparty_id uuid references public.counterparties(id);

-- Backfill delle 9 righe esistenti via structure_id -> counterparties
-- (tutte e 9 le regole attuali sono per strutture attive, gia' presenti
-- come counterparty dal backfill della migration precedente).
update public.consulting_fee_rules r
set counterparty_id = cp.id
from public.counterparties cp
where cp.structure_id = r.structure_id
  and r.counterparty_id is null;

alter table public.consulting_fee_rules
  alter column structure_id drop not null;

alter table public.consulting_fee_rules
  alter column counterparty_id set not null;

create index if not exists idx_consulting_fee_rules_counterparty
  on public.consulting_fee_rules(counterparty_id);

-- ---------- consulting_reconciliation_issues ----------
-- Resta verticale (confermato) - qui aggiunge solo counterparty_id,
-- structure_id era gia' nullable di suo.
alter table public.consulting_reconciliation_issues
  add column if not exists counterparty_id uuid references public.counterparties(id);

create index if not exists idx_consulting_reconciliation_issues_counterparty
  on public.consulting_reconciliation_issues(counterparty_id);

-- Diagnostica: 0 righe orfane, tutte e 9 le regole esistenti preservate e
-- ricollegate.
select
  (select count(*) from public.consulting_fee_rules) as fee_rules_totali,
  (select count(*) from public.consulting_fee_rules where counterparty_id is null) as fee_rules_senza_counterparty;
