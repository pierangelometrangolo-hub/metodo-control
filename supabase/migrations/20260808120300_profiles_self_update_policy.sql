-- ============ FIX 1: policy UPDATE mancante su profiles ============
-- La migrazione 20260808120100 ha abilitato RLS su profiles aggiungendo
-- solo una policy RESTRICTIVE per INSERT. Senza nessuna policy PERMISSIVE
-- per UPDATE, con RLS abilitata nessun update via anon key + JWT utente
-- è più possibile per NESSUNO (default-deny), nemmeno sul proprio record:
-- questo contraddice il requisito "non bloccare la scrittura degli altri
-- campi... sul proprio record". Aggiunge la policy PERMISSIVE mancante,
-- scoped esplicitamente alla propria riga (auth.uid() = id): un utente
-- non può mai toccare la riga di un altro utente tramite questa policy.

create policy profiles_update_own_record
on profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- ============ FIX 2: il trigger deve proteggere anche is_active ============
-- La policy sopra permette la scrittura di QUALSIASI campo del proprio
-- record, incluso is_active. Senza una guardia dedicata, un utente
-- disattivato da un master potrebbe riattivarsi da solo con una singola
-- chiamata UPDATE diretta. Il trigger esistente (trg_guard_profiles_level_change,
-- da 20260808120100) controllava solo "level": lo sostituiamo con una
-- versione che guarda anche "is_active", stesso principio, stesso
-- meccanismo OLD/NEW via trigger (non RLS, per lo stesso motivo tecnico
-- già spiegato per "level"). Rinominato per riflettere lo scope più ampio.

drop trigger if exists trg_guard_profiles_level_change on profiles;
drop function if exists fn_guard_profiles_level_change();

create or replace function fn_guard_profiles_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (NEW.level is distinct from OLD.level
      or NEW.is_active is distinct from OLD.is_active)
     and fn_user_level_rank(auth.uid()) < 3 then
    raise exception 'Non autorizzato a modificare level o is_active';
  end if;

  return NEW;
end;
$$;

create trigger trg_guard_profiles_privileged_fields
before update on profiles
for each row
execute function fn_guard_profiles_privileged_fields();
