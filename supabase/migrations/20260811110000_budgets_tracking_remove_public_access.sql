-- ============ FIX BLOCCANTE: accesso pubblico (senza login) a budgets/tracking/tracking_history ============
-- Audit sicurezza 2026-08-11: alcune policy avevano "roles: {public}" invece
-- di "{authenticated}", con qual/with_check = true. In Postgres/PostgREST il
-- ruolo "public" copre anche "anon", quindi chiunque usasse la sola chiave
-- anon pubblica del progetto (quella incorporata nel bundle JS del sito),
-- SENZA fare login, poteva leggere tutti i budget e leggere/scrivere/
-- inserire righe di tracking e del relativo storico. Verificato
-- empiricamente con un client anonimo (nessuna sessione autenticata): letti
-- tutti i budget, tutte le righe tracking, ed eseguita con successo una
-- UPDATE reale su una riga di tracking (poi ripristinata a mano).
--
-- Fix: le policy "public" vengono sostituite da equivalenti "authenticated"
-- (stesso qual/with_check, solo il ruolo cambia). Questo NON introduce
-- restrizioni per livello (quello e' un intervento separato, gia'
-- pianificato per performance_daily_snapshot) - qui si chiude solo il
-- requisito minimo: serve un login valido, punto.
--
-- Le policy "authenticated" gia' esistenti su tracking (select/insert/
-- update _authenticated e _own) restano intatte e continuano a coprire
-- l'operativita' per gli utenti loggati - qui si tocca solo cio' che era
-- raggiungibile senza alcun login.

-- budgets: nessun'altra policy SELECT esiste oltre a questa - va sostituita,
-- non solo rimossa, altrimenti nessuno (nemmeno senior/master) potrebbe piu'
-- leggere i budget (stesso bug "RLS attiva senza policy" visto piu' volte).
drop policy budgets_select_all on budgets;
create policy budgets_select_authenticated
on budgets
for select
to authenticated
using (true);

-- tracking: select/insert/update "authenticated" equivalenti esistono gia'
-- (tracking_select_authenticated, tracking_insert_authenticated,
-- tracking_update_authenticated) - qui basta rimuovere le versioni public.
drop policy tracking_select on tracking;
drop policy tracking_insert on tracking;
drop policy tracking_update on tracking;

-- tracking_history: il SELECT authenticated esiste gia'
-- (tracking_history_select_authenticated), ma l'INSERT authenticated non
-- esiste - l'unica policy INSERT era quella public. Il client scrive qui
-- direttamente dopo ogni update di tracking (components/time-tracking/
-- TrackingList.tsx), quindi va sostituita, non solo rimossa, altrimenti si
-- rompe lo storico modifiche per gli utenti reali.
drop policy tracking_history_select on tracking_history;
drop policy tracking_history_insert on tracking_history;
create policy tracking_history_insert_authenticated
on tracking_history
for insert
to authenticated
with check (true);
