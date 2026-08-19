-- ============ PROPOSTA — NON ESEGUIRE — Finance Core: classificazione (DOVE) + Economic Category (CHE COSA) ============
-- Dipende da 20260816095000 (organizations).
--
-- Business Unit -> Project -> Initiative risponde a "dove appartiene
-- economicamente" il documento, ora scoped per organization (non piu'
-- valori globali del motore Finance) come richiesto.
--
-- Economic Category e' un asse SEPARATO e ortogonale ("che cosa e'": es.
-- Consulenza/Software/Telefonia/Viaggi/Advertising/Professionisti) - non
-- va confuso con Business Unit. Creo solo il punto di estensione (tabella
-- + colonna nullable), nessuna categoria seedata: "non e' necessario
-- popolare ora tutte le categorie" per esplicita indicazione.

create table public.finance_business_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint finance_business_units_unique_code_per_org unique (organization_id, code)
);

create table public.finance_projects (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.finance_business_units(id),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint finance_projects_unique_code_per_bu unique (business_unit_id, code)
);

create table public.finance_initiatives (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.finance_projects(id),
  code text not null,
  name text not null,
  period_start date,
  period_end date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint finance_initiatives_unique_code_per_project unique (project_id, code)
);

-- ---------- Economic Category (asse "che cosa", non "dove") ----------
create table public.finance_economic_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
-- Nessuna categoria inserita in questa migration - tabella vuota, punto di
-- estensione pronto per quando servira' popolarla.

alter table public.finance_business_units enable row level security;
alter table public.finance_projects enable row level security;
alter table public.finance_initiatives enable row level security;
alter table public.finance_economic_categories enable row level security;

create policy finance_business_units_select_authenticated on public.finance_business_units for select to authenticated using (true);
create policy finance_projects_select_authenticated on public.finance_projects for select to authenticated using (true);
create policy finance_initiatives_select_authenticated on public.finance_initiatives for select to authenticated using (true);
create policy finance_economic_categories_select_authenticated on public.finance_economic_categories for select to authenticated using (true);

create policy finance_business_units_write_senior_master on public.finance_business_units for all to authenticated using (fn_user_level_rank(auth.uid()) >= 2) with check (fn_user_level_rank(auth.uid()) >= 2);
create policy finance_projects_write_senior_master on public.finance_projects for all to authenticated using (fn_user_level_rank(auth.uid()) >= 2) with check (fn_user_level_rank(auth.uid()) >= 2);
create policy finance_initiatives_write_senior_master on public.finance_initiatives for all to authenticated using (fn_user_level_rank(auth.uid()) >= 2) with check (fn_user_level_rank(auth.uid()) >= 2);
create policy finance_economic_categories_write_senior_master on public.finance_economic_categories for all to authenticated using (fn_user_level_rank(auth.uid()) >= 2) with check (fn_user_level_rank(auth.uid()) >= 2);

-- ============ SEED — Business Unit/Project per l'organization MeToDo ============
-- Organization confermata (20260816095000): MeToDo. Seedo qui solo i
-- valori confermati per nome: Consulenza/Formazione/Eventi come Business
-- Unit, PDO come Project sotto Eventi. Nessuna tappa/iniziativa PDO
-- inserita - "non creare ancora tappe se non abbiamo nomi reali
-- confermati dal dataset/documenti", arriveranno con il batch import dei
-- 233 documenti.

insert into public.finance_business_units (organization_id, code, name)
select o.id, bu.code, bu.name
from public.organizations o
cross join (values ('consulenza', 'Consulenza'), ('formazione', 'Formazione'), ('eventi', 'Eventi')) as bu(code, name)
where o.name = 'MeToDo';

insert into public.finance_projects (business_unit_id, code, name)
select bu.id, 'pdo', 'PDO'
from public.finance_business_units bu
join public.organizations o on o.id = bu.organization_id
where o.name = 'MeToDo' and bu.code = 'eventi';

-- Diagnostica: 3 business unit, 1 project (PDO sotto Eventi), 0 initiative.
select
  (select count(*) from public.finance_business_units) as business_units,
  (select count(*) from public.finance_projects) as projects,
  (select count(*) from public.finance_initiatives) as initiatives;
