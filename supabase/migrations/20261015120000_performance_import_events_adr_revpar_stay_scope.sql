-- ============ Import Integrity — scope soggiorno anche per ADR/RevPAR ============
--
-- PROPOSTA — da eseguire manualmente su Supabase solo dopo conferma.
--
-- Problema reale (15/10/2026, Palazzo Rollo): Booking Designer non esporta
-- piu' di un anno per file, quindi la stessa extraction_date puo' avere piu'
-- export ADR/RevPAR annuali e disgiunti:
--   ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Palazzo Rollo - 2026-10-15.csv
--   ADR - RevPAR (01 Gen 2027 - 31 Dic 2027) - Palazzo Rollo - 2026-10-15.csv
-- La chiave di adr_revpar era structure_id + extraction_date + dataset, senza
-- scope: il file 2027 veniva confrontato con l'evento 2026 (hash diverso) e
-- bloccato come content_conflict, pur non avendo alcuna riga in comune.
--
-- Fix: adr_revpar adotta la stessa chiave stay-scope gia' in produzione per
-- montecallini_pms (20260930130000) - nessuna seconda implementazione:
--   - stesso intervallo, stesso hash          -> skipped_duplicate
--   - stesso intervallo, hash diverso         -> conflict (content_conflict)
--   - intervalli disgiunti (anche adiacenti)  -> nuovo import valido
--   - intervalli parzialmente sovrapposti     -> conflict (scope_overlap)
--   - evento storico con scope NULL           -> regola storica invariata
--   - guardia legacy limitata allo scope del payload
-- nationality resta invariato.
--
-- Unica modifica rispetto alla definizione attiva (20260930130000): la
-- dichiarazione di v_scoped (piu' commenti). Firma, lock advisory sulla
-- chiave structure_id+extraction_date+dataset, guardia legacy, scrittura
-- atomica e SECURITY INVOKER invariati. Nessuna modifica di schema: le
-- colonne stay_date_start/stay_date_end esistono gia' e tutti gli eventi
-- 'imported' adr_revpar hanno gia' uno scope (verifica in sola lettura del
-- 15/10/2026: 20 eventi, 0 senza scope) - nessun backfill necessario.

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
  -- Dataset con lo scope soggiorno nella chiave (lib/performance/ingestion/
  -- conflictPolicy.ts STAY_SCOPED_DATASETS): montecallini_pms e adr_revpar.
  v_scoped boolean := p_dataset in ('montecallini_pms', 'adr_revpar');
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
  -- scope (montecallini_pms, adr_revpar), o per la stessa chiave tout court
  -- (nationality). Un evento con scope NULL si considera sovrapposto a tutto
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

  -- Guardia legacy: righe gia' presenti senza evento. Per i dataset con
  -- scope solo dentro lo scope soggiorno del payload (righe di altri
  -- periodi sulla stessa extraction_date non sono lo stesso snapshot);
  -- nationality invariato (intera chiave structure_id + extraction_date).
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
  'Unico punto di scrittura atomica per il servizio import Performance - serializzata da un pg_advisory_xact_lock su structure_id+extraction_date+dataset (prima operazione sensibile allo stato/DB). Chiave duplicato/conflitto: structure_id+extraction_date+dataset, piu'' lo scope soggiorno [stay_date_start, stay_date_end] ricavato dal payload per montecallini_pms e adr_revpar (stesso scope -> dedup/conflict per hash, disgiunto -> import valido, sovrapposto -> conflict scope_overlap, evento storico senza scope -> regola storica). Guardia legacy limitata allo scope per montecallini_pms e adr_revpar. Scrittura bd_imports+righe dataset+performance_import_events in una sola transazione Postgres implicita.';

-- ---------- Verifica post-migration (da eseguire a mano) ----------
-- select prosrc like '%p_dataset in (''montecallini_pms'', ''adr_revpar'')%' as adr_revpar_scoped
-- from pg_proc where proname = 'fn_commit_performance_import';
-- Atteso: true. Poi ricaricare il file 2027 di Palazzo Rollo (15/10/2026):
-- atteso status imported, scope 2027-01-01 - 2027-12-31, righe 2026 invariate.
