-- ============ guest_nationality: abilita INSERT per il nuovo import da UI ============
-- Finora guest_nationality aveva solo SELECT (popolata via import esterno,
-- vedi 20260810090000): il nuovo tipo di import "Nazionalità" nella
-- sezione Import scrive da app, quindi serve una policy INSERT.
--
-- Soglia rank >= 2, stessa di performance_daily_snapshot_insert_senior_master
-- (20260811140000) - non la vecchia "true" di bd_imports_insert_authenticated
-- (20260808150000, precedente all'audit di sicurezza): quella e' rimasta
-- permissiva per compatibilita' con dati gia' esistenti, ma ogni nuova
-- policy di scrittura su dati economici/di reportistica in questo modulo
-- segue ormai la convenzione post-audit.
create policy guest_nationality_insert_senior_master
on guest_nationality
for insert
to authenticated
with check (fn_user_level_rank(auth.uid()) >= 2);
