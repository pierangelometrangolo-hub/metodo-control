-- ============ TASK 2: RLS su profiles ============
-- Non tocca le policy SELECT esistenti su profiles/tasks/tracking.
-- Aggiunge solo restrizioni additive su INSERT e sulla colonna "level".

alter table profiles enable row level security;

-- INSERT: solo utenti con rank master possono creare nuovi profili.
-- Policy RESTRICTIVE: si combina in AND con eventuali policy INSERT
-- permissive già esistenti (es. self-signup), quindi restringe senza
-- sostituire o rimuovere nulla.
create policy profiles_insert_master_only
on profiles
as restrictive
for insert
to authenticated
with check (fn_user_level_rank(auth.uid()) >= 3);

-- Blocco scrittura del campo "level": implementato con un trigger e non
-- con una RLS policy, perché in RLS il WITH CHECK di un UPDATE vede solo
-- la riga NEW: confrontare NEW.level con il valore OLD tramite una
-- subquery sulla stessa tabella non è affidabile all'interno dello stesso
-- comando. Un trigger BEFORE UPDATE risolve il confronto OLD/NEW in modo
-- corretto, senza toccare le policy di scrittura già esistenti sugli
-- altri campi (che restano permesse per l'utente proprietario del record).
create or replace function fn_guard_profiles_level_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.level is distinct from OLD.level
     and fn_user_level_rank(auth.uid()) < 3 then
    raise exception 'Non autorizzato a modificare il livello utente';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_guard_profiles_level_change on profiles;

create trigger trg_guard_profiles_level_change
before update on profiles
for each row
execute function fn_guard_profiles_level_change();
