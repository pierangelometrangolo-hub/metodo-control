-- ============ PROPOSTA — NON ESEGUIRE — Consulting: consulting_engagements ============
-- Migration strutturale, neutra rispetto al batch fatture 2025/2026:
-- crea il livello Counterparty -> Consulting Engagement -> Fee Rules e
-- backfilla le 15 regole esistenti sulle counterparty placeholder gia' in
-- uso oggi. NESSUN dato fiscale/mapping emerso dall'audit delle fatture
-- viene scritto qui (nessun ripuntamento Kelina/Cantine Due Palme, nessun
-- aggiornamento legal_name/vat_number per Volito/La Roccia/La Villa/Sea
-- Garden) - quel lavoro appartiene al futuro ingestion/resolution layer,
-- che fara' il matching con le identita' fiscali reali estratte dagli XML
-- (P.IVA/CF), verificando prima eventuali counterparty gia' esistenti.
--
-- Specifico del verticale Consulting - non tocca Finance Core generale.

create table public.consulting_engagements (
  id uuid primary key default gen_random_uuid(),
  counterparty_id uuid not null references public.counterparties(id),
  structure_id uuid references public.structures(id),  -- opzionale, solo se l'engagement corrisponde anche a una struttura Performance
  display_name text not null,
  valid_from date,
  valid_to date,
  status text not null default 'active',  -- 'active' | 'closed'
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consulting_engagements_status_check check (status in ('active', 'closed'))
);

-- ---------- Strategia UNIQUE ----------
-- UNIQUE(counterparty_id, display_name) rigida bloccherebbe un caso
-- legittimo: la stessa controparte fiscale con un secondo engagement dello
-- stesso nome in un periodo successivo (contratto chiuso, poi ripreso
-- dopo una pausa). Un indice UNIQUE parziale, limitato agli engagement
-- 'active', risolve entrambi i lati senza introdurre un vero controllo di
-- non-overlap temporale (complessita' non necessaria per la V1, dato che
-- un solo engagement per nome puo' essere attivo alla volta - due attivi
-- contemporaneamente sarebbero comunque un'ambiguita' reale su quale
-- erediti le fee rules future): consente N engagement CLOSED nel tempo con
-- lo stesso (counterparty_id, display_name), ma al massimo uno ACTIVE.
create unique index idx_consulting_engagements_unique_active
  on public.consulting_engagements(counterparty_id, display_name) where status = 'active';

create index idx_consulting_engagements_counterparty on public.consulting_engagements(counterparty_id);
create index idx_consulting_engagements_structure on public.consulting_engagements(structure_id);

alter table public.consulting_engagements enable row level security;
create policy consulting_engagements_select_authenticated on public.consulting_engagements for select to authenticated using (true);
create policy consulting_engagements_write_senior_master on public.consulting_engagements for all to authenticated using (fn_user_level_rank(auth.uid()) >= 2) with check (fn_user_level_rank(auth.uid()) >= 2);

-- ============ Backfill: 1 engagement per counterparty gia' referenziata da consulting_fee_rules ============
-- Copre tutte e 15 le regole esistenti - un engagement per ciascuna delle
-- 13 counterparty distinte oggi collegate a consulting_fee_rules (6
-- operative + 7 storiche), ereditando display_name/structure_id dalla
-- counterparty. Nessun merge, nessun ripuntamento: le storiche restano
-- sulle rispettive counterparty placeholder.
--
-- status: NON il default 'active' per tutte - deriva da
-- counterparties.status ('active' -> 'active', 'inactive' -> 'closed'),
-- gia' verificato riga per riga: le 6 operative sono 'active', le 7
-- storiche sono 'inactive' in counterparties.
--
-- valid_from/valid_to: MIN/MAX delle valid_from/valid_to gia' presenti in
-- consulting_fee_rules per quella counterparty - nessun periodo inventato,
-- solo aggregazione di dati gia' confermati.
insert into public.consulting_engagements (counterparty_id, structure_id, display_name, status, valid_from, valid_to)
select
  cp.id,
  cp.structure_id,
  cp.display_name,
  case cp.status when 'active' then 'active' else 'closed' end,
  min(r.valid_from),
  max(r.valid_to)
from public.consulting_fee_rules r
join public.counterparties cp on cp.id = r.counterparty_id
group by cp.id, cp.structure_id, cp.display_name, cp.status;

alter table public.consulting_fee_rules
  add column if not exists consulting_engagement_id uuid references public.consulting_engagements(id);

update public.consulting_fee_rules r
set consulting_engagement_id = e.id
from public.consulting_engagements e
where e.counterparty_id = r.counterparty_id
  and e.display_name = (select display_name from public.counterparties where id = r.counterparty_id)
  and r.consulting_engagement_id is null;

-- ---------- Diagnostica PRE-DROP (esplicita, da controllare prima di continuare) ----------
-- Deve dare fee_rules_totali=15, fee_rules_con_engagement=15,
-- fee_rules_orfane=0. Se fee_rules_orfane > 0, FERMARSI qui: non
-- proseguire con SET NOT NULL / DROP COLUMN finche' non e' 0.
select
  (select count(*) from public.consulting_fee_rules) as fee_rules_totali,
  (select count(*) from public.consulting_fee_rules where consulting_engagement_id is not null) as fee_rules_con_engagement,
  (select count(*) from public.consulting_fee_rules where consulting_engagement_id is null) as fee_rules_orfane;

-- ---------- Solo se la diagnostica sopra conferma 0 orfane ----------
alter table public.consulting_fee_rules
  alter column consulting_engagement_id set not null;

-- counterparty_id rimosso: un solo owner (consulting_engagement_id), mai
-- due FK che potrebbero divergere.
alter table public.consulting_fee_rules drop column counterparty_id;

create index idx_consulting_fee_rules_engagement on public.consulting_fee_rules(consulting_engagement_id);

-- Diagnostica finale: 15 fee rules, 13 engagement, colonna counterparty_id
-- non piu' presente su consulting_fee_rules.
select
  (select count(*) from public.consulting_fee_rules) as fee_rules_totali,
  (select count(*) from public.consulting_engagements) as engagements_totali,
  (select column_name from information_schema.columns where table_schema='public' and table_name='consulting_fee_rules' and column_name='counterparty_id') as colonna_counterparty_id_residua;

-- ============ Mapping fiscali noti dal batch — SOLO PROMEMORIA, nessuna azione ============
-- Kelina -> CANTINE DUE PALME SOCIETA' COOPERATIVA (stessa controparte di Villa Neviera)
-- Volito -> LIDO VENERE S.R.L.
-- La Roccia -> LA SPADA NELLA ROCCIA SRL
-- La Villa -> LAVILLA S.R.L.
-- Sea Garden -> GARDEN SEA DI COLIZZI PAOLO
-- Nessuna P.IVA/CF acquisita ancora per queste 5 in modo strutturato (da
-- XML, non da questo testo) - il resolver di ingestion fara' il matching
-- reale e decidera' se serve un ripuntamento (come per Kelina) o un
-- semplice aggiornamento anagrafico, verificando prima eventuali
-- counterparty gia' esistenti con la stessa P.IVA.
