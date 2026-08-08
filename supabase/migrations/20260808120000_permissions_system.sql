-- ============ ASSE LIVELLO ============
create type user_level as enum ('user', 'senior', 'master');

create table user_level_rank (
  level user_level primary key,
  rank  smallint not null unique
);
insert into user_level_rank (level, rank) values
  ('user', 1), ('senior', 2), ('master', 3);

alter table profiles
  add column level user_level not null default 'user';

alter table profiles
  add column if not exists is_active boolean not null default true;

-- ============ ASSE MODULO ============
create table macro_areas (
  id   uuid primary key default gen_random_uuid(),
  key  text unique not null,
  name text not null
);

create table modules (
  id            uuid primary key default gen_random_uuid(),
  key           text unique not null,
  name          text not null,
  macro_area_id uuid references macro_areas(id),
  sort_order    int default 0,
  is_active     boolean default true
);

create table macro_area_min_level (
  macro_area_id uuid primary key references macro_areas(id),
  min_level     user_level not null
);

create table level_module_access (
  level       user_level not null references user_level_rank(level),
  module_id   uuid not null references modules(id),
  can_view    boolean not null default false,
  primary key (level, module_id)
);

create table user_module_overrides (
  user_id     uuid not null references profiles(id),
  module_id   uuid not null references modules(id),
  can_view    boolean not null,
  primary key (user_id, module_id)
);

-- ============ FUNZIONE DI RISOLUZIONE ============
-- Precedenza: macroarea vince sempre -> override utente -> default livello×modulo
create or replace function fn_user_can_view_module(p_user_id uuid, p_module_key text)
returns boolean
language sql stable security definer
as $$
  with m as (
    select id, macro_area_id from modules where key = p_module_key and is_active
  ),
  lvl as (
    select level from profiles where id = p_user_id
  )
  select case
    when exists (
      select 1 from m
      join macro_area_min_level mal on mal.macro_area_id = m.macro_area_id
      join user_level_rank req on req.level = mal.min_level
      join user_level_rank cur on cur.level = (select level from lvl)
      where cur.rank < req.rank
    ) then false
    when exists (select 1 from user_module_overrides uo join m on uo.module_id = m.id where uo.user_id = p_user_id)
      then (select can_view from user_module_overrides uo join m on uo.module_id = m.id where uo.user_id = p_user_id)
    else coalesce((
      select lma.can_view from level_module_access lma
      join m on lma.module_id = m.id
      where lma.level = (select level from lvl)
    ), false)
  end
$$;

create or replace function fn_user_level_rank(p_user_id uuid)
returns smallint
language sql stable security definer
as $$
  select ulr.rank from profiles p
  join user_level_rank ulr on ulr.level = p.level
  where p.id = p_user_id
$$;

-- ============ SEED MODULI ============
insert into modules (key, name, sort_order) values
  ('operations', 'Operations', 1),
  ('tracking_registra', 'Tracking - Registra', 2),
  ('tracking_analisi', 'Tracking - Analisi', 3),
  ('performance', 'Performance', 4),
  ('dashboard', 'Dashboard', 5),
  ('admin_users', 'Gestione Utenti', 6);

-- Operations: visibile a tutti i livelli
insert into level_module_access (level, module_id, can_view)
select l, m.id, true
from unnest(array['user','senior','master']::user_level[]) as l
join modules m on m.key = 'operations';

-- Tracking - Registra: visibile a tutti i livelli
insert into level_module_access (level, module_id, can_view)
select l, m.id, true
from unnest(array['user','senior','master']::user_level[]) as l
join modules m on m.key = 'tracking_registra';

-- Tracking - Analisi: solo senior e master
insert into level_module_access (level, module_id, can_view)
select l, m.id, (l != 'user')
from unnest(array['user','senior','master']::user_level[]) as l
join modules m on m.key = 'tracking_analisi';

-- Performance: solo senior e master
insert into level_module_access (level, module_id, can_view)
select l, m.id, (l != 'user')
from unnest(array['user','senior','master']::user_level[]) as l
join modules m on m.key = 'performance';

-- Dashboard: visibile a tutti i livelli
insert into level_module_access (level, module_id, can_view)
select l, m.id, true
from unnest(array['user','senior','master']::user_level[]) as l
join modules m on m.key = 'dashboard';

-- admin_users: nessuna riga qui, gating gestito via fn_user_level_rank
-- direttamente in TASK 4, non tramite level_module_access

-- macro_area_min_level resta vuota per ora: nessuna riga da inserire
-- (Amministrazione & Finance non esiste ancora come modulo reale)
