-- ============ Import Integrity Foundation (Fase 1) — fn_commit_performance_import ============
-- Unico punto di scrittura atomica del servizio import Performance
-- (lib/performance/ingestion/importService.ts). Sostituisce il pattern
-- precedente "insert righe, se fallisce DELETE compensativo su bd_imports"
-- (processFileImport in app/(control)/performance/import/page.tsx, ora
-- rimosso): qui l'intera funzione gira in UNA sola transazione Postgres
-- implicita (il modo in cui PostgREST esegue una RPC con effetti
-- collaterali) - se una qualunque istruzione al suo interno solleva
-- un'eccezione, TUTTO cio' che questa chiamata ha scritto (bd_imports,
-- righe dataset, l'evento stesso) viene annullato automaticamente da
-- Postgres, senza bisogno di un blocco EXCEPTION che catturi e ripulisca a
-- mano. Nessun eccezione viene catturata qui apposta - lasciarla propagare
-- e' cio' che garantisce "BLOCKING ERROR -> zero snapshot parziali".
--
-- La funzione decide da sola (rilettura di performance_import_events
-- DENTRO la stessa transazione) se si tratta di duplicato esatto,
-- duplicato semantico, conflitto, o prima scrittura valida - il chiamante
-- (TypeScript) ha gia' calcolato gli hash e passa qui solo dati, non la
-- decisione: questo evita una finestra di race fra "controllo lato client"
-- e "scrittura", dato che qui il controllo e la scrittura sono nella
-- stessa transazione.
--
-- SECURITY INVOKER (default, nessuna clausola esplicita necessaria): gira
-- con i privilegi dell'utente chiamante, la RLS di
-- bd_imports/performance_daily_snapshot/guest_nationality/
-- performance_import_events si applica esattamente come se le singole
-- INSERT fossero fatte direttamente dal client - nessuna duplicazione dei
-- controlli di livello dentro la funzione.
--
-- ============ Hardening (correzione post-Fase 1, seconda revisione) ============
-- Il servizio TypeScript (lib/performance/ingestion/repository.ts,
-- checkLegacySnapshotExists) gia' verifica PRIMA di chiamare questa RPC se
-- il dataset target contiene gia' righe scritte prima che
-- performance_import_events esistesse ("snapshot legacy") - ma fra quella
-- SELECT lato client e l'arrivo qui c'e' una finestra in cui un altro
-- import potrebbe scrivere esattamente quella riga legacy. Senza una
-- guardia anche qui dentro, l'unico segnale sarebbe una violazione grezza
-- del vincolo UNIQUE su performance_daily_snapshot/guest_nationality - un
-- errore Postgres generico, mai un evento di audit dedicato.
--
-- Questa funzione ripete quindi LA STESSA verifica, dentro la stessa
-- transazione, come guardia finale autoritativa (mai un semplice
-- affidarsi al pre-check lato client, che resta solo per UX/fast-fail).
-- Strategia scelta: A - nessuna eccezione sollevata, un insert
-- dell'evento 'conflict'/'legacy_snapshot_present' nella stessa
-- transazione della verifica stessa, PRIMA di qualunque insert su
-- bd_imports/performance_daily_snapshot/guest_nationality - quindi un
-- eventuale rollback dei dati non puo' mai "portarsi via" questo evento,
-- dato che a quel punto nessun dato e' ancora stato scritto. Stessi
-- vincoli della verifica gia' fatta lato TypeScript: NESSUN
-- source_checksum/normalized_content_hash inventato per il lato legacy
-- (che non esiste) - solo quelli reali del file/batch in ingresso, gia'
-- calcolati dal chiamante.
--
-- ============ Hardening (correzione post-Fase 1, quarta revisione) ============
-- La guardia legacy sopra elimina la race fra il pre-check TypeScript e
-- QUESTA funzione, ma da sola NON basta contro due chiamate CONCORRENTI a
-- fn_commit_performance_import sulla STESSA chiave (structure_id,
-- extraction_date, dataset): sotto l'isolamento READ COMMITTED di
-- Postgres (il default, invariato in questo progetto), due transazioni
-- possono entrambe eseguire la "select * into v_existing"/il controllo
-- legacy PRIMA che l'altra abbia fatto commit, vedere entrambe "nessun
-- import precedente" ed entrambe procedere verso l'insert - il vincolo
-- UNIQUE finirebbe comunque per fermare la seconda, ma solo dopo aver
-- gia' scritto (e dovuto poi annullare) bd_imports/righe dataset, ed e'
-- proprio il tipo di corsa "check-then-act" multi-sessione che le
-- garanzie sopra non coprono (loro risolvono solo "stesso dato gia'
-- scritto", non "due scritture in corso nello stesso istante").
--
-- Soluzione: un advisory lock TRANSAZIONALE Postgres
-- (pg_advisory_xact_lock), acquisito come PRIMA operazione sensibile allo
-- stato/DB della funzione - prima di qualunque query o scrittura che possa
-- osservare o modificare stato persistente. La sola costruzione locale
-- della stringa di chiave logica (v_lock_key) puo' precederlo: e' un
-- calcolo in memoria, non legge ne' scrive nulla di persistente, quindi
-- non e' un "controllo prima del lock".
-- La chiave e' deterministica, derivata da structure_id +
-- extraction_date + dataset (mai una chiave globale: import su
-- strutture/date/dataset diversi non si bloccano mai a vicenda). Una
-- seconda chiamata concorrente sulla STESSA chiave si blocca qui,
-- silenziosamente, finche' la prima non fa COMMIT o ROLLBACK - nessun
-- codice di retry/sleep lato client, e nessuna riga scritta finche' il
-- lock non e' stato ottenuto. pg_advisory_xact_lock (a differenza di
-- pg_advisory_lock) e' automaticamente rilasciato alla fine della
-- transazione, qualunque sia l'esito - mai serve un unlock esplicito, e
-- non puo' restare "appeso" se la funzione termina con un'eccezione.
create or replace function fn_commit_performance_import(
  p_structure_id uuid,
  p_extraction_date date,
  p_dataset text,
  p_source text,
  p_source_checksum text,
  p_normalized_content_hash text,
  p_batch_hash text,
  p_uploaded_by uuid,
  p_bd_source text,
  p_report_type text,
  p_source_files jsonb,
  p_snapshot_rows jsonb,
  p_nationality_rows jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_existing record;
  v_bd_import_ids uuid[] := '{}';
  v_file jsonb;
  v_new_bd_import_id uuid;
  v_event_id uuid;
  v_file_names text;
  v_row_count integer := 0;
  v_legacy_exists boolean;
  v_lock_key text;
begin
  -- ============ Serializzazione sulla chiave logica ============
  -- Acquisito come PRIMA operazione sensibile allo stato/DB della funzione:
  -- prima di qualunque query o scrittura che possa osservare o modificare
  -- stato persistente. Solo la riga qui sotto (costruzione in memoria di
  -- v_lock_key) lo precede - calcolo locale, nessun accesso a dati
  -- persistenti, e per questo ammesso.
  -- Chiave deterministica = structure_id + extraction_date + dataset,
  -- MAI una chiave globale: due chiamate su chiavi diverse non si
  -- bloccano mai fra loro, solo due chiamate sulla STESSA chiave si
  -- serializzano. hashtext() produce un int4 deterministico per la
  -- stessa stringa in ingresso nella stessa esecuzione del cluster
  -- (sufficiente per un lock transitorio come questo, che non deve
  -- restare valido/confrontabile oltre la vita del processo Postgres) -
  -- due hash con un prefisso diverso ("a:"/"b:") riducono il rischio che
  -- una collisione di hashtext su chiavi logiche diverse le faccia
  -- serializzare per errore (innocuo se capita: nel peggiore dei casi due
  -- import non correlati si mettono in coda l'uno con l'altro, mai una
  -- corsa mancata sulla stessa chiave reale).
  v_lock_key := p_structure_id::text || '|' || coalesce(p_extraction_date::text, 'null') || '|' || p_dataset;
  perform pg_advisory_xact_lock(hashtext('a:' || v_lock_key), hashtext('b:' || v_lock_key));

  -- Import gia' completato in passato per questa stessa
  -- struttura+data+dataset? (anche di sessioni/upload precedenti, mai solo
  -- di questo batch - vedi commento su performance_import_events).
  select * into v_existing
  from performance_import_events
  where structure_id = p_structure_id
    and extraction_date = p_extraction_date
    and dataset = p_dataset
    and status = 'imported'
  order by created_at desc
  limit 1;

  if found then
    if v_existing.source_checksum is not null and v_existing.source_checksum = p_source_checksum then
      insert into performance_import_events (
        structure_id, extraction_date, dataset, source, source_checksum,
        normalized_content_hash, batch_hash, status, source_file_name
      ) values (
        p_structure_id, p_extraction_date, p_dataset, p_source, p_source_checksum,
        p_normalized_content_hash, p_batch_hash, 'skipped_duplicate',
        (select string_agg(f->>'file_name', ', ') from jsonb_array_elements(p_source_files) f)
      )
      returning id into v_event_id;

      return jsonb_build_object('status', 'skipped_duplicate', 'reason', 'exact_duplicate', 'event_id', v_event_id);
    end if;

    if v_existing.normalized_content_hash is not null and v_existing.normalized_content_hash = p_normalized_content_hash then
      insert into performance_import_events (
        structure_id, extraction_date, dataset, source, source_checksum,
        normalized_content_hash, batch_hash, status, source_file_name
      ) values (
        p_structure_id, p_extraction_date, p_dataset, p_source, p_source_checksum,
        p_normalized_content_hash, p_batch_hash, 'skipped_duplicate',
        (select string_agg(f->>'file_name', ', ') from jsonb_array_elements(p_source_files) f)
      )
      returning id into v_event_id;

      return jsonb_build_object('status', 'skipped_duplicate', 'reason', 'semantic_duplicate', 'event_id', v_event_id);
    end if;

    -- Contenuto diverso sulla stessa struttura+data+dataset: MAI un
    -- overwrite, MAI "vince l'ultimo file" - conflitto bloccante, zero
    -- scritture su bd_imports/performance_daily_snapshot/guest_nationality.
    insert into performance_import_events (
      structure_id, extraction_date, dataset, source, source_checksum,
      normalized_content_hash, batch_hash, status, source_file_name, error_code, error_message
    ) values (
      p_structure_id, p_extraction_date, p_dataset, p_source, p_source_checksum,
      p_normalized_content_hash, p_batch_hash, 'conflict',
      (select string_agg(f->>'file_name', ', ') from jsonb_array_elements(p_source_files) f),
      'content_conflict',
      'Un import gia'' completato per questa struttura/data/dataset ha un contenuto diverso (normalized_content_hash ' || v_existing.normalized_content_hash || ' vs ' || p_normalized_content_hash || '). Richiede risoluzione umana.'
    )
    returning id into v_event_id;

    return jsonb_build_object('status', 'conflict', 'event_id', v_event_id, 'conflicting_event_id', v_existing.id);
  end if;

  -- Nessun performance_import_event 'imported' per questa chiave - ma il
  -- dataset target potrebbe gia' contenere righe scritte PRIMA che questo
  -- sistema esistesse (es. lo snapshot BD 08/09/2026 gia' in produzione),
  -- oppure comparse nella finestra fra il pre-check lato client e questa
  -- chiamata. performance_daily_snapshot ospita SIA adr_revpar SIA
  -- montecallini_pms (nessuna colonna "dataset": il suo UNIQUE e' su
  -- structure_id+stay_date+extraction_date indipendentemente da chi ha
  -- scritto le righe) - stesso ambito per entrambi i dataset, guest_nationality
  -- solo per nationality.
  if p_dataset = 'nationality' then
    select exists(
      select 1 from guest_nationality
      where structure_id = p_structure_id and extraction_date = p_extraction_date
    ) into v_legacy_exists;
  else
    select exists(
      select 1 from performance_daily_snapshot
      where structure_id = p_structure_id and extraction_date = p_extraction_date
    ) into v_legacy_exists;
  end if;

  if v_legacy_exists then
    -- Zero scritture su bd_imports/performance_daily_snapshot/guest_nationality
    -- da qui in poi per questa chiamata: si esce SUBITO, mai si arriva al
    -- loop di insert sotto. MAI una classificazione automatica come
    -- duplicato esatto/semantico (nessun hash legacy da cui dedurla) -
    -- sempre e solo conflict/legacy_snapshot_present, identico esito e
    -- messaggio del pre-check lato client (repository.ts,
    -- LEGACY_SNAPSHOT_CONFLICT_MESSAGE) per restare un unico messaggio
    -- coerente indipendentemente da QUALE dei due controlli lo intercetta.
    insert into performance_import_events (
      structure_id, extraction_date, dataset, source, source_checksum,
      normalized_content_hash, batch_hash, status, source_file_name, error_code, error_message
    ) values (
      p_structure_id, p_extraction_date, p_dataset, p_source, p_source_checksum,
      p_normalized_content_hash, p_batch_hash, 'conflict',
      (select string_agg(f->>'file_name', ', ') from jsonb_array_elements(p_source_files) f),
      'legacy_snapshot_present',
      'Esiste già uno snapshot precedente alla Import Integrity Foundation per questa struttura/data/dataset. Non è possibile stabilire automaticamente se il file sia duplicato o differente. Import bloccato e richiesta verifica umana.'
    )
    returning id into v_event_id;

    return jsonb_build_object('status', 'conflict', 'event_id', v_event_id, 'conflicting_event_id', null);
  end if;

  -- Nessun import precedente completato per questa chiave e nessuna riga
  -- legacy sulla stessa chiave: procedi con la scrittura. Un bd_imports
  -- per ciascun file sorgente (stessa granularita' di audit gia' in uso
  -- oggi, un file = un bd_imports), anche quando piu' file compongono un
  -- solo batch (Montecallini).
  for v_file in select * from jsonb_array_elements(p_source_files)
  loop
    insert into bd_imports (structure_id, source, report_type, file_name, file_path, extraction_date, uploaded_by)
    values (p_structure_id, p_bd_source, p_report_type, v_file->>'file_name', v_file->>'file_path', p_extraction_date, p_uploaded_by)
    returning id into v_new_bd_import_id;

    v_bd_import_ids := array_append(v_bd_import_ids, v_new_bd_import_id);
  end loop;

  if p_snapshot_rows is not null and jsonb_array_length(p_snapshot_rows) > 0 then
    insert into performance_daily_snapshot (
      structure_id, stay_date, stay_year, extraction_date,
      revenue_total, rooms_sold, rooms_available, arrivals, presences, bd_import_id
    )
    select
      p_structure_id,
      (r->>'stay_date')::date,
      extract(year from (r->>'stay_date')::date)::int,
      p_extraction_date,
      (r->>'revenue_total')::numeric,
      (r->>'rooms_sold')::numeric,
      (r->>'rooms_available')::numeric,
      case when r->>'arrivals' is null then null else (r->>'arrivals')::numeric end,
      (r->>'presences')::numeric,
      v_bd_import_ids[coalesce((r->>'source_index')::int, 0) + 1]
    from jsonb_array_elements(p_snapshot_rows) r;

    get diagnostics v_row_count = row_count;
  end if;

  if p_nationality_rows is not null and jsonb_array_length(p_nationality_rows) > 0 then
    insert into guest_nationality (structure_id, stay_date, extraction_date, nationality, presences, bd_import_id)
    select
      p_structure_id,
      (r->>'stay_date')::date,
      p_extraction_date,
      r->>'nationality',
      (r->>'presences')::numeric,
      v_bd_import_ids[coalesce((r->>'source_index')::int, 0) + 1]
    from jsonb_array_elements(p_nationality_rows) r;

    get diagnostics v_row_count = row_count;
  end if;

  select string_agg(f->>'file_name', ', ') into v_file_names from jsonb_array_elements(p_source_files) f;

  insert into performance_import_events (
    structure_id, extraction_date, dataset, source, source_checksum,
    normalized_content_hash, batch_hash, status, bd_import_id, source_file_name
  ) values (
    p_structure_id, p_extraction_date, p_dataset, p_source, p_source_checksum,
    p_normalized_content_hash, p_batch_hash, 'imported', v_bd_import_ids[1], v_file_names
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'status', 'imported',
    'event_id', v_event_id,
    'imported_count', v_row_count,
    'bd_import_ids', to_jsonb(v_bd_import_ids)
  );
end;
$$;

comment on function fn_commit_performance_import is
  'Unico punto di scrittura atomica per il servizio import Performance - serializzata da un pg_advisory_xact_lock su structure_id+extraction_date+dataset (prima operazione sensibile allo stato/DB della funzione, prima di qualunque query o scrittura su stato persistente - solo la costruzione in memoria della chiave logica la precede - rilasciato automaticamente a commit/rollback), poi dedup esatto/semantico, rilevamento conflitto (incluso contro snapshot legacy pre-Foundation, verificato qui come guardia finale oltre al pre-check lato client), e scrittura bd_imports+righe dataset+performance_import_events in una sola transazione Postgres implicita. Nessuna gestione di eccezioni al suo interno per design: un errore qui annulla automaticamente tutto cio'' che questa chiamata ha scritto.';
