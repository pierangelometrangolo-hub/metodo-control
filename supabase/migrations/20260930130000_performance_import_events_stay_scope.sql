-- ============ Import Integrity — scope soggiorno degli eventi ============
--
-- Problema reale (30/09/2026, Montecallini): la chiave logica di
-- duplicato/conflitto era structure_id + extraction_date + dataset, senza
-- l'intervallo di soggiorno coperto dall'import. Per il PMS Montecallini
-- piu' file mensili caricati in momenti diversi dello stesso giorno hanno la
-- STESSA extraction_date per CY (oggi) e SDLY (oggi meno un anno) - es.
-- settembre 2026 e ottobre 2026 entrambi su 2026-09-30 - e il secondo veniva
-- confrontato col primo come se fosse lo stesso snapshot logico: hash
-- diverso -> content_conflict, anche se i soggiorni non si sovrappongono
-- (e il vincolo UNIQUE structure_id+stay_date+extraction_date di
-- performance_daily_snapshot non avrebbe avuto nulla da obiettare).
--
-- Nuova chiave per montecallini_pms:
--   structure_id + extraction_date + dataset + [stay_date_start, stay_date_end]
--   - stesso intervallo, stesso hash          -> skipped_duplicate
--   - stesso intervallo, hash diverso         -> conflict (content_conflict)
--   - intervalli disgiunti                    -> nuovo import valido
--   - intervalli parzialmente sovrapposti     -> conflict (scope_overlap)
--   - evento storico con scope NULL           -> regola storica invariata
--     (confronto hash sull'intera chiave, conflitto se diverso): mai un
--     bypass per un evento di cui non si conosce lo scope.
-- adr_revpar e nationality: chiave invariata (lo scope viene solo
-- registrato sugli eventi, mai usato per decidere).

-- ---------- 1. Schema ----------
alter table performance_import_events
  add column stay_date_start date,
  add column stay_date_end date;

alter table performance_import_events
  add constraint performance_import_events_stay_scope_check
  check (
    (stay_date_start is null and stay_date_end is null)
    or (stay_date_start is not null and stay_date_end is not null and stay_date_start <= stay_date_end)
  );

comment on column performance_import_events.stay_date_start is
  'Primo giorno di soggiorno coperto dalle righe del file/batch (min stay_date del payload). NULL = scope non noto (eventi precedenti a questa colonna non ricostruibili, o esiti pre-parsing).';
comment on column performance_import_events.stay_date_end is
  'Ultimo giorno di soggiorno coperto dalle righe del file/batch (max stay_date del payload). Stesse regole di stay_date_start.';

-- ---------- 2. Backfill degli eventi 'imported' esistenti ----------
-- Solo gli eventi 'imported' partecipano a duplicato/conflitto. Lo scope si
-- ricostruisce dalle righe realmente scritte dal loro batch: l'evento
-- collega solo il primo bd_imports del batch, ma tutti i bd_imports di una
-- stessa chiamata RPC condividono structure_id, extraction_date e
-- imported_at (now() = timestamp della transazione). Un evento viene
-- valorizzato SOLO se:
--   - il suo batch non contiene il bd_import_id di un altro evento
--     (nessuna ambiguita' fra batch),
--   - esiste almeno una riga collegata.
-- Altrimenti resta NULL (regola storica, vedi sopra). Verifica pre-migration
-- sui dati reali del 30/09/2026: 22 eventi 'imported', 22 ricostruibili,
-- 0 ambigui. Per un batch con mesi non contigui l'intervallo min..max e'
-- piu' ampio dei mesi reali: sovrastima prudente (piu' sovrapposizioni ->
-- piu' conflitti), mai un bypass.
with ev as (
  select e.id, e.dataset, b.structure_id, b.extraction_date, b.imported_at
  from performance_import_events e
  join bd_imports b on b.id = e.bd_import_id
  where e.status = 'imported'
    and e.stay_date_start is null
),
batch as (
  select ev.id as event_id, ev.dataset, bi.id as bd_import_id
  from ev
  join bd_imports bi
    on bi.structure_id = ev.structure_id
   and bi.extraction_date = ev.extraction_date
   and bi.imported_at = ev.imported_at
),
ambiguous as (
  select distinct b.event_id
  from batch b
  join performance_import_events other
    on other.bd_import_id = b.bd_import_id
   and other.id <> b.event_id
   and other.status = 'imported'
),
scope as (
  select b.event_id, min(r.stay_date) as stay_date_start, max(r.stay_date) as stay_date_end
  from batch b
  join (
    select bd_import_id, stay_date, 'snapshot' as kind from performance_daily_snapshot
    union all
    select bd_import_id, stay_date, 'nationality' as kind from guest_nationality
  ) r
    on r.bd_import_id = b.bd_import_id
   and r.kind = case when b.dataset = 'nationality' then 'nationality' else 'snapshot' end
  where b.event_id not in (select event_id from ambiguous)
  group by b.event_id
)
update performance_import_events e
set stay_date_start = scope.stay_date_start,
    stay_date_end = scope.stay_date_end
from scope
where e.id = scope.event_id;

-- ---------- 3. RPC ----------
-- Stessa firma della versione precedente (20260908113200): lo scope NON e'
-- un parametro passato dal client, la funzione lo ricava dalle righe che
-- sta per scrivere (p_snapshot_rows/p_nationality_rows), quindi resta
-- l'autorita' finale anche sullo scope. Lock, guardia legacy, atomicita' e
-- SECURITY INVOKER invariati.
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
  v_scope_start date;
  v_scope_end date;
  -- Solo il PMS Montecallini usa lo scope soggiorno nella chiave.
  v_scoped boolean := p_dataset = 'montecallini_pms';
  v_same_scope boolean;
begin
  -- ============ Serializzazione sulla chiave logica ============
  -- Invariato: prima operazione sensibile allo stato/DB della funzione.
  -- La chiave del lock resta structure_id + extraction_date + dataset
  -- (piu' ampia dello scope): due import sulla stessa chiave si
  -- serializzano anche se hanno scope diversi, mai una corsa mancata
  -- (race check-then-act fra due sessioni sotto READ COMMITTED).
  v_lock_key := p_structure_id::text || '|' || coalesce(p_extraction_date::text, 'null') || '|' || p_dataset;
  perform pg_advisory_xact_lock(hashtext('a:' || v_lock_key), hashtext('b:' || v_lock_key));

  -- Scope soggiorno del payload (calcolo sui soli parametri in ingresso).
  select min((r->>'stay_date')::date), max((r->>'stay_date')::date)
  into v_scope_start, v_scope_end
  from jsonb_array_elements(
    case when p_dataset = 'nationality' then coalesce(p_nationality_rows, '[]'::jsonb)
         else coalesce(p_snapshot_rows, '[]'::jsonb) end
  ) r;

  -- Import gia' completato per la stessa chiave che si SOVRAPPONE allo
  -- scope (montecallini_pms), o per la stessa chiave tout court (altri
  -- dataset). Un evento con scope NULL si considera sovrapposto a tutto
  -- (regola storica). A parita', prima l'evento con lo STESSO scope.
  select * into v_existing
  from performance_import_events
  where structure_id = p_structure_id
    and extraction_date = p_extraction_date
    and dataset = p_dataset
    and status = 'imported'
    and (
      not v_scoped
      or v_scope_start is null
      or stay_date_start is null
      or (stay_date_start <= v_scope_end and stay_date_end >= v_scope_start)
    )
  order by
    (stay_date_start is not distinct from v_scope_start and stay_date_end is not distinct from v_scope_end) desc,
    created_at desc
  limit 1;

  if found then
    v_same_scope := not v_scoped
      or v_scope_start is null
      or v_existing.stay_date_start is null
      or (v_existing.stay_date_start = v_scope_start and v_existing.stay_date_end = v_scope_end);

    if not v_same_scope then
      -- Intervalli parzialmente sovrapposti: nessun confronto hash possibile
      -- fra due snapshot con scope diversi - conflitto bloccante.
      insert into performance_import_events (
        structure_id, extraction_date, dataset, source, source_checksum,
        normalized_content_hash, batch_hash, status, source_file_name, error_code, error_message,
        stay_date_start, stay_date_end
      ) values (
        p_structure_id, p_extraction_date, p_dataset, p_source, p_source_checksum,
        p_normalized_content_hash, p_batch_hash, 'conflict',
        (select string_agg(f->>'file_name', ', ') from jsonb_array_elements(p_source_files) f),
        'scope_overlap',
        'Un import gia'' completato per questa struttura/data/dataset copre un intervallo di soggiorno parzialmente sovrapposto (' || v_existing.stay_date_start || ' - ' || v_existing.stay_date_end || ' vs ' || v_scope_start || ' - ' || v_scope_end || '). Richiede risoluzione umana.',
        v_scope_start, v_scope_end
      )
      returning id into v_event_id;

      return jsonb_build_object('status', 'conflict', 'reason', 'scope_overlap', 'event_id', v_event_id, 'conflicting_event_id', v_existing.id);
    end if;

    if v_existing.source_checksum is not null and v_existing.source_checksum = p_source_checksum then
      insert into performance_import_events (
        structure_id, extraction_date, dataset, source, source_checksum,
        normalized_content_hash, batch_hash, status, source_file_name,
        stay_date_start, stay_date_end
      ) values (
        p_structure_id, p_extraction_date, p_dataset, p_source, p_source_checksum,
        p_normalized_content_hash, p_batch_hash, 'skipped_duplicate',
        (select string_agg(f->>'file_name', ', ') from jsonb_array_elements(p_source_files) f),
        v_scope_start, v_scope_end
      )
      returning id into v_event_id;

      return jsonb_build_object('status', 'skipped_duplicate', 'reason', 'exact_duplicate', 'event_id', v_event_id);
    end if;

    if v_existing.normalized_content_hash is not null and v_existing.normalized_content_hash = p_normalized_content_hash then
      insert into performance_import_events (
        structure_id, extraction_date, dataset, source, source_checksum,
        normalized_content_hash, batch_hash, status, source_file_name,
        stay_date_start, stay_date_end
      ) values (
        p_structure_id, p_extraction_date, p_dataset, p_source, p_source_checksum,
        p_normalized_content_hash, p_batch_hash, 'skipped_duplicate',
        (select string_agg(f->>'file_name', ', ') from jsonb_array_elements(p_source_files) f),
        v_scope_start, v_scope_end
      )
      returning id into v_event_id;

      return jsonb_build_object('status', 'skipped_duplicate', 'reason', 'semantic_duplicate', 'event_id', v_event_id);
    end if;

    -- Stesso scope (o scope storico sconosciuto), contenuto diverso: MAI un
    -- overwrite, MAI "vince l'ultimo file" - conflitto bloccante.
    insert into performance_import_events (
      structure_id, extraction_date, dataset, source, source_checksum,
      normalized_content_hash, batch_hash, status, source_file_name, error_code, error_message,
      stay_date_start, stay_date_end
    ) values (
      p_structure_id, p_extraction_date, p_dataset, p_source, p_source_checksum,
      p_normalized_content_hash, p_batch_hash, 'conflict',
      (select string_agg(f->>'file_name', ', ') from jsonb_array_elements(p_source_files) f),
      'content_conflict',
      'Un import gia'' completato per questa struttura/data/dataset ha un contenuto diverso (normalized_content_hash ' || v_existing.normalized_content_hash || ' vs ' || p_normalized_content_hash || '). Richiede risoluzione umana.',
      v_scope_start, v_scope_end
    )
    returning id into v_event_id;

    return jsonb_build_object('status', 'conflict', 'reason', 'content_conflict', 'event_id', v_event_id, 'conflicting_event_id', v_existing.id);
  end if;

  -- Guardia legacy: righe gia' presenti senza evento. Per montecallini_pms
  -- solo dentro lo scope soggiorno del payload (righe di altri mesi sulla
  -- stessa extraction_date non sono lo stesso snapshot); altri dataset
  -- invariati (intera chiave structure_id + extraction_date).
  if p_dataset = 'nationality' then
    select exists(
      select 1 from guest_nationality
      where structure_id = p_structure_id and extraction_date = p_extraction_date
    ) into v_legacy_exists;
  else
    select exists(
      select 1 from performance_daily_snapshot
      where structure_id = p_structure_id
        and extraction_date = p_extraction_date
        and (not v_scoped or v_scope_start is null or stay_date between v_scope_start and v_scope_end)
    ) into v_legacy_exists;
  end if;

  if v_legacy_exists then
    insert into performance_import_events (
      structure_id, extraction_date, dataset, source, source_checksum,
      normalized_content_hash, batch_hash, status, source_file_name, error_code, error_message,
      stay_date_start, stay_date_end
    ) values (
      p_structure_id, p_extraction_date, p_dataset, p_source, p_source_checksum,
      p_normalized_content_hash, p_batch_hash, 'conflict',
      (select string_agg(f->>'file_name', ', ') from jsonb_array_elements(p_source_files) f),
      'legacy_snapshot_present',
      'Esiste già uno snapshot precedente alla Import Integrity Foundation per questa struttura/data/dataset. Non è possibile stabilire automaticamente se il file sia duplicato o differente. Import bloccato e richiesta verifica umana.',
      v_scope_start, v_scope_end
    )
    returning id into v_event_id;

    return jsonb_build_object('status', 'conflict', 'reason', 'legacy_snapshot_present', 'event_id', v_event_id, 'conflicting_event_id', null);
  end if;

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
    normalized_content_hash, batch_hash, status, bd_import_id, source_file_name,
    stay_date_start, stay_date_end
  ) values (
    p_structure_id, p_extraction_date, p_dataset, p_source, p_source_checksum,
    p_normalized_content_hash, p_batch_hash, 'imported', v_bd_import_ids[1], v_file_names,
    v_scope_start, v_scope_end
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
  'Unico punto di scrittura atomica per il servizio import Performance - serializzata da un pg_advisory_xact_lock su structure_id+extraction_date+dataset (prima operazione sensibile allo stato/DB). Chiave duplicato/conflitto: structure_id+extraction_date+dataset, piu'' lo scope soggiorno [stay_date_start, stay_date_end] ricavato dal payload per montecallini_pms (stesso scope -> dedup/conflict per hash, disgiunto -> import valido, sovrapposto -> conflict scope_overlap, evento storico senza scope -> regola storica). Guardia legacy limitata allo scope per montecallini_pms. Scrittura bd_imports+righe dataset+performance_import_events in una sola transazione Postgres implicita.';

-- ---------- Verifica post-migration (da eseguire a mano) ----------
-- select status, dataset, count(*) filter (where stay_date_start is null) as senza_scope, count(*)
-- from performance_import_events group by 1, 2 order by 1, 2;
-- Atteso al 30/09/2026: imported -> senza_scope 0 (22 eventi).
