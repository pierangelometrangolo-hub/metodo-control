-- ============ FIX: RLS abilitata senza policy su tabelle statiche ============
-- Diagnosticato dopo che il modal "Moduli" in /admin/utenti risultava vuoto:
-- modules, macro_areas, macro_area_min_level e user_level_rank risultano
-- avere Row Level Security abilitata con ZERO policy definite. Nessuna
-- delle migrazioni di questo sistema di permessi (20260808120000/100/200/300)
-- ha mai toccato queste quattro tabelle: l'abilitazione è avvenuta altrove
-- (verosimilmente un'azione manuale nel Table Editor di Supabase, non
-- ricordata da nessuno dei presenti).
--
-- Effetto pratico: con RLS attiva e nessuna policy, PostgREST non ritorna
-- un errore di permesso ma un array vuoto per QUALSIASI ruolo (anon,
-- authenticated, incluso un utente master reale) — un fallimento silenzioso
-- particolarmente insidioso perché indistinguibile via console/network da
-- "la tabella è vuota".
--
-- Per design queste tabelle sono dati di riferimento non sensibili e non
-- dovevano avere alcuna restrizione (esplicitamente dichiarato per
-- modules/macro_areas/macro_area_min_level in TASK 2b; user_level_rank è
-- una semplice mappa enum->rango, mai stata oggetto di una policy in
-- nessuna migrazione). Le funzioni security definer (fn_user_level_rank,
-- fn_user_can_view_module) restano comunque funzionanti a prescindere,
-- perché girano con i privilegi del proprietario e bypassano RLS: il
-- problema riguardava solo le letture dirette lato client.

alter table modules disable row level security;
alter table macro_areas disable row level security;
alter table macro_area_min_level disable row level security;
alter table user_level_rank disable row level security;
