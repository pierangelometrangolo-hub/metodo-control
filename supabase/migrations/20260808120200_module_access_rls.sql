-- ============ TASK 2b: RLS in lettura su level_module_access e user_module_overrides ============
-- Non tocca modules / macro_areas / macro_area_min_level (non richiesto).
-- fn_user_can_view_module è security definer e gira con i privilegi del
-- proprietario delle tabelle (che bypassa RLS di default), quindi continua
-- a funzionare per tutti i livelli anche dopo questa restrizione: va
-- verificato con il test in fondo, non assunto per certo.

alter table level_module_access enable row level security;
alter table user_module_overrides enable row level security;

create policy level_module_access_select_master_only
on level_module_access
for select
to authenticated
using (fn_user_level_rank(auth.uid()) >= 3);

create policy user_module_overrides_select_master_only
on user_module_overrides
for select
to authenticated
using (fn_user_level_rank(auth.uid()) >= 3);
