-- ============ PROPOSTA — NON ESEGUIRE — Finance Core: organizations + legal_entities ============
-- GAP CONFERMATO: cercato in tutto il codice e in tutte le tabelle
-- Supabase (schema OpenAPI PostgREST) - nessuna entita' equivalente a
-- "organization" o "legal_entity" esiste oggi. Il Finance Core e' stato
-- costruito finora (crm_clients, structures, consulting_*) assumendo
-- implicitamente un solo soggetto emittente/ricevente, mai reso esplicito.
--
-- Modello minimo, senza assumere 1:1 organization/legal_entity anche se
-- oggi per GAP coincidono logicamente:
--
--   organization (es. "GAP" come brand/gruppo)
--     -> legal_entity (una o piu' ragioni sociali/P.IVA che operano sotto
--        quell'organization - oggi probabilmente una sola per GAP, ma il
--        modello non lo forza)
--
-- NON creo nessuna riga qui: non conosco con certezza la ragione sociale e
-- la P.IVA reali di GAP/MeToDo. Non le invento. Vedi nota finale.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint organizations_status_check check (status in ('active', 'inactive'))
);

create table public.legal_entities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  vat_number text,
  fiscal_code text,
  country text,
  is_default boolean not null default false,  -- entita' legale usata di default quando un finance_document non la specifica esplicitamente
  created_at timestamptz not null default now()
);

create unique index idx_legal_entities_vat_number
  on public.legal_entities(vat_number) where vat_number is not null;

-- Al massimo una legal_entity di default per organization - evita
-- ambiguita' quando l'ingestion deve scegliere un'entita' legale implicita.
create unique index idx_legal_entities_one_default_per_org
  on public.legal_entities(organization_id) where is_default;

create index idx_legal_entities_organization on public.legal_entities(organization_id);

alter table public.organizations enable row level security;
alter table public.legal_entities enable row level security;

create policy organizations_select_authenticated on public.organizations for select to authenticated using (true);
create policy organizations_write_senior_master on public.organizations for all to authenticated using (fn_user_level_rank(auth.uid()) >= 2) with check (fn_user_level_rank(auth.uid()) >= 2);

create policy legal_entities_select_authenticated on public.legal_entities for select to authenticated using (true);
create policy legal_entities_write_senior_master on public.legal_entities for all to authenticated using (fn_user_level_rank(auth.uid()) >= 2) with check (fn_user_level_rank(auth.uid()) >= 2);

-- ============ SEED — organization MeToDo + legal entity GAP GROUP S.R.L. ============
-- Confermato: organization (perimetro gestionale) e legal entity (soggetto
-- giuridico/fiscale) sono concettualmente distinti, non li tratto come 1:1
-- implicito nonostante oggi ci sia una sola legal entity nota.
--
-- vat_number/fiscal_code forniti direttamente da Pierangelo (05320500753),
-- non estratti da un documento sorgente - nessuna fattura reale
-- (XML/P7M) e' ancora presente in repository o nello storage Supabase.

insert into public.organizations (name, status)
values ('MeToDo', 'active');

insert into public.legal_entities (organization_id, name, vat_number, fiscal_code, country, is_default)
select id, 'GAP GROUP S.R.L.', '05320500753', '05320500753', 'IT', true
from public.organizations where name = 'MeToDo';

-- Diagnostica: 1 organization, 1 legal_entity collegata e marcata default.
select o.name as organization, le.name as legal_entity, le.vat_number, le.fiscal_code, le.country, le.is_default
from public.organizations o
join public.legal_entities le on le.organization_id = o.id;
