-- ============ Import Integrity Foundation (Fase 1) — structure_source_aliases ============
-- Prima tabella della "Import Integrity Foundation" comune a upload
-- manuale attuale e futura automazione Google Drive (non implementata qui
-- - vedi performance_import_events nella migration successiva). Sostituisce
-- la costante hardcoded BD_STRUCTURE_NAME_ALIASES che viveva in
-- lib/performanceImportRouting.ts: il mapping "nome che la fonte esterna
-- scrive nel filename" -> "structures.id reale" deve ora essere letto dal
-- DB a runtime, non duplicato in codice.
--
-- Regola di matching (applicata lato codice in
-- lib/performance/ingestion/routing.ts, mai qui): match ESATTO
-- sull'alias, mai fuzzy/contains/best-guess. 0 righe trovate per un
-- (source, alias-normalizzato) -> errore bloccante "struttura non
-- riconosciuta". >1 struttura diversa risultante -> errore bloccante
-- "ambiguo". La tabella stessa aiuta a prevenire il caso ambiguo con lo
-- UNIQUE su (source, alias) sotto - due strutture non possono mai
-- registrare lo stesso alias per la stessa fonte.
create table structure_source_aliases (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references structures(id),
  source text not null,
  alias text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  -- Stesso alias non può essere registrato due volte per la stessa fonte
  -- (su strutture uguali o diverse) - previene sia la duplicazione
  -- innocua sia il vero caso di ambiguità silenziosa.
  constraint structure_source_aliases_source_alias_unique unique (source, alias),
  constraint structure_source_aliases_alias_not_blank check (btrim(alias) <> ''),
  constraint structure_source_aliases_source_not_blank check (btrim(source) <> '')
);

create index structure_source_aliases_structure_id_idx on structure_source_aliases (structure_id);
create index structure_source_aliases_source_idx on structure_source_aliases (source) where is_active;

comment on table structure_source_aliases is
  'Mapping esplicito "nome struttura come scritto dalla fonte esterna" -> structures.id. Match SOLO esatto (mai fuzzy) - vedi lib/performance/ingestion/routing.ts. is_active=false disattiva un alias senza perderne lo storico (mai un DELETE su un alias gia'' usato in produzione).';
comment on column structure_source_aliases.source is
  'Fonte che scrive questo nome: "booking_designer" per ADR/RevPAR e Nazionalita'' (stesso filename/nome struttura in entrambi i report BD). Montecallini NON ha righe qui: il suo unico formato (PMS "PlanningForecast", CSV ";"-delimited) identifica la struttura strutturalmente, un alias sarebbe ridondante - vedi commento in lib/performance/ingestion/routing.ts.';
comment on column structure_source_aliases.alias is
  'Segmento struttura ESATTO come compare nel filename della fonte (es. "Palazzo De'' Belli", "Sangiorgio Resort _____" con i caratteri spuri inclusi) - mai una versione "pulita" o normalizzata a mano: deve combaciare byte per byte (a meno di trim) con quanto la fonte produce davvero.';

alter table structure_source_aliases enable row level security;

-- Lettura: chiunque possa usare il modulo Performance (rank >= 2, stessa
-- soglia di performance_daily_snapshot/guest_nationality/bd-import-files -
-- il modulo Performance stesso e' senior/master-only, vedi SENIOR_RANK in
-- app/(control)/performance/import/page.tsx). Nessuna policy INSERT/UPDATE/
-- DELETE: gestione alias non prevista da UI in questa fase (nessuna UI di
-- gestione richiesta), scritture solo via service role/SQL Editor.
create policy structure_source_aliases_select_senior_master
on structure_source_aliases
for select
to authenticated
using (fn_user_level_rank(auth.uid()) >= 2);

-- ============ Seed alias reali noti (Booking Designer) ============
-- Verificati su filename reali osservati in questa sessione (ADR/RevPAR e
-- Ospiti per provenienza - stesso nome struttura in entrambi i report BD,
-- generato da BD stesso). "Palazzo Rollo" e' incluso anche se identico al
-- nome DB: il resolver fa SEMPRE match esatto contro questa tabella (mai
-- un fallback implicito su structures.name), quindi ogni struttura BD
-- reale deve avere una riga qui, identity o no, per essere risolvibile.
insert into structure_source_aliases (structure_id, source, alias)
select s.id, 'booking_designer', v.alias
from (values
  ('Villa Neviera', 'Villa Neviera Wine Resort'),
  ('Dimora De Belli', 'Palazzo De'' Belli'),
  ('Sangiorgio Resort', 'Sangiorgio Resort _____'),
  ('Palazzo Arco Cadura', 'Palazzo Arco Cadura Hotel & SPA'),
  ('Palazzo Rollo', 'Palazzo Rollo')
) as v(structure_name, alias)
join structures s on s.name = v.structure_name;
