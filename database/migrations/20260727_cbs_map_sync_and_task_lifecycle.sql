begin;

-- A parcel is a cadastral object and can contain more than one greenhouse unit.
-- Keep the greenhouse geometry on greenhouse_units; do not overwrite one parcel
-- geometry with the last greenhouse drawn by an inspector.
alter table public.kobuks_units
  add column if not exists cbs_unit_id bigint references public.cbs_units(id) on delete set null,
  add column if not exists greenhouse_unit_id bigint references public.greenhouse_units(id) on delete set null,
  add column if not exists parcel_polygon jsonb,
  add column if not exists greenhouse_polygon jsonb,
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists updated_at timestamptz;

alter table public.tasks
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists reactivated_at timestamptz,
  add column if not exists reactivated_by uuid references public.profiles(id) on delete set null;

create index if not exists kobuks_units_parcel_lookup_idx
  on public.kobuks_units(ada_no, parcel_no);
create index if not exists kobuks_units_cbs_unit_id_idx
  on public.kobuks_units(cbs_unit_id);
create index if not exists greenhouse_units_cbs_unit_id_idx
  on public.greenhouse_units(cbs_unit_id);
create index if not exists tasks_cancelled_at_idx
  on public.tasks(cancelled_at desc)
  where cancelled_at is not null;

create or replace function public.sync_cbs_polygon(
  p_task_id bigint,
  p_cbs_unit_id bigint,
  p_tkgm_parcel_id text,
  p_city text,
  p_district text,
  p_village text,
  p_ada_no text,
  p_parcel_no text,
  p_unit_no text,
  p_registration_no text,
  p_producer_id bigint,
  p_parcel_polygon jsonb,
  p_greenhouse_polygon jsonb,
  p_latitude numeric,
  p_longitude numeric,
  p_greenhouse_area numeric,
  p_task_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_task public.tasks%rowtype;
  v_cbs_unit_id bigint;
  v_greenhouse_unit_id bigint;
  v_inspection_id bigint;
  v_kobuks_linked boolean := false;
begin
  select role into v_role from public.profiles where id = auth.uid();

  if v_role not in ('admin', 'manager', 'inspector') then
    raise exception 'CBS poligonu yazma yetkiniz bulunmuyor.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_greenhouse_polygon) <> 'array' or jsonb_array_length(p_greenhouse_polygon) < 3 then
    raise exception 'Sera poligonu en az üç köşe içermelidir.' using errcode = '22023';
  end if;

  if p_task_id is not null then
    select * into v_task from public.tasks where id = p_task_id for update;

    if not found then
      raise exception 'Görev bulunamadı.' using errcode = 'P0002';
    end if;

    if v_role = 'inspector'
      and coalesce(v_task.assigned_to, v_task.user_id) is distinct from auth.uid() then
      raise exception 'Bu görevin poligonunu güncelleme yetkiniz bulunmuyor.' using errcode = '42501';
    end if;
  end if;

  if p_cbs_unit_id is not null then
    update public.cbs_units
    set
      tkgm_parcel_id = coalesce(nullif(tkgm_parcel_id, ''), nullif(p_tkgm_parcel_id, '')),
      city = coalesce(nullif(city, ''), nullif(p_city, '')),
      district = coalesce(nullif(district, ''), nullif(p_district, '')),
      village = coalesce(nullif(village, ''), nullif(p_village, '')),
      ada_no = coalesce(nullif(ada_no, ''), nullif(p_ada_no, '')),
      parcel_no = coalesce(nullif(parcel_no, ''), nullif(p_parcel_no, '')),
      parcel_polygon = case
        when jsonb_typeof(p_parcel_polygon) = 'array' and jsonb_array_length(p_parcel_polygon) >= 3 then p_parcel_polygon
        else parcel_polygon
      end,
      latitude = coalesce(p_latitude, latitude),
      longitude = coalesce(p_longitude, longitude),
      updated_by = auth.uid(),
      updated_at = now()
    where id = p_cbs_unit_id
    returning id into v_cbs_unit_id;
  end if;

  if v_cbs_unit_id is null and nullif(p_tkgm_parcel_id, '') is not null then
    select id into v_cbs_unit_id
    from public.cbs_units
    where tkgm_parcel_id = p_tkgm_parcel_id
    limit 1
    for update;
  end if;

  if v_cbs_unit_id is null then
    insert into public.cbs_units (
      tkgm_parcel_id, city, district, village, ada_no, parcel_no,
      parcel_polygon, latitude, longitude, source, source_accuracy,
      created_by, updated_by, updated_at
    ) values (
      nullif(p_tkgm_parcel_id, ''), p_city, p_district, p_village, p_ada_no, p_parcel_no,
      p_parcel_polygon, p_latitude, p_longitude, 'manual_cbs_polygon', 'field_drawn_greenhouse',
      auth.uid(), auth.uid(), now()
    )
    returning id into v_cbs_unit_id;
  end if;

  insert into public.greenhouse_units (
    cbs_unit_id, producer_id, unit_no, registration_no, greenhouse_area,
    parcel_polygon, greenhouse_polygon, latitude, longitude, status, updated_at
  ) values (
    v_cbs_unit_id, p_producer_id, p_unit_no, nullif(p_registration_no, ''), p_greenhouse_area,
    p_parcel_polygon, p_greenhouse_polygon, p_latitude, p_longitude, 'active', now()
  )
  on conflict (unit_no) do update
  set
    cbs_unit_id = excluded.cbs_unit_id,
    producer_id = coalesce(excluded.producer_id, greenhouse_units.producer_id),
    registration_no = coalesce(excluded.registration_no, greenhouse_units.registration_no),
    greenhouse_area = excluded.greenhouse_area,
    parcel_polygon = coalesce(excluded.parcel_polygon, greenhouse_units.parcel_polygon),
    greenhouse_polygon = excluded.greenhouse_polygon,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    status = 'active',
    updated_at = now()
  returning id into v_greenhouse_unit_id;

  update public.kobuks_units
  set
    cbs_unit_id = v_cbs_unit_id,
    greenhouse_unit_id = v_greenhouse_unit_id,
    parcel_polygon = coalesce(p_parcel_polygon, parcel_polygon),
    greenhouse_polygon = p_greenhouse_polygon,
    latitude = p_latitude,
    longitude = p_longitude,
    updated_at = now()
  where unit_no = p_unit_no;
  v_kobuks_linked := found;

  if p_task_id is not null then
    update public.tasks
    set
      cbs_unit_id = v_cbs_unit_id,
      greenhouse_unit_id = v_greenhouse_unit_id,
      parcel_polygon = p_parcel_polygon,
      greenhouse_polygon = p_greenhouse_polygon,
      latitude = p_latitude,
      longitude = p_longitude,
      description = coalesce(p_task_description, description)
    where id = p_task_id;

    select inspection_id into v_inspection_id from public.tasks where id = p_task_id;

    if v_inspection_id is not null then
      update public.inspection_history
      set
        greenhouse_unit_id = v_greenhouse_unit_id,
        producer_id = coalesce(p_producer_id, producer_id),
        unit_no = p_unit_no,
        latitude = p_latitude,
        longitude = p_longitude
      where id = v_inspection_id;
    else
      insert into public.inspection_history (
        greenhouse_unit_id, producer_id, inspector_user_id, task_id,
        unit_no, status, latitude, longitude
      ) values (
        v_greenhouse_unit_id, p_producer_id, auth.uid(), p_task_id,
        p_unit_no, coalesce(v_task.workflow_status, v_task.status, 'Sahada'), p_latitude, p_longitude
      )
      returning id into v_inspection_id;

      update public.tasks set inspection_id = v_inspection_id where id = p_task_id;
    end if;
  end if;

  return jsonb_build_object(
    'cbs_unit_id', v_cbs_unit_id,
    'greenhouse_unit_id', v_greenhouse_unit_id,
    'inspection_id', v_inspection_id,
    'kobuks_linked', v_kobuks_linked,
    'targets', array_remove(array[
      'cbs_units', 'greenhouse_units',
      case when p_task_id is not null then 'tasks' end,
      case when p_task_id is not null then 'inspection_history' end,
      case when v_kobuks_linked then 'kobuks_units' end
    ], null)
  );
end;
$$;

revoke all on function public.sync_cbs_polygon(
  bigint, bigint, text, text, text, text, text, text, text, text, bigint, jsonb, jsonb, numeric, numeric, numeric, text
) from public;
grant execute on function public.sync_cbs_polygon(
  bigint, bigint, text, text, text, text, text, text, text, text, bigint, jsonb, jsonb, numeric, numeric, numeric, text
) to authenticated;

create or replace function public.reactivate_cancelled_task(p_task_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_task public.tasks%rowtype;
begin
  select role into v_role from public.profiles where id = auth.uid();

  if v_role not in ('admin', 'manager') then
    raise exception 'Görevi yeniden aktifleştirme yetkiniz bulunmuyor.' using errcode = '42501';
  end if;

  update public.tasks
  set
    workflow_status = case when assigned_to is null then 'Bekliyor' else 'Sahaya Atandı' end,
    status = case when assigned_to is null then 'Bekliyor' else 'Sahaya Atandı' end,
    reactivated_at = now(),
    reactivated_by = auth.uid(),
    cancelled_at = null,
    cancelled_by = null,
    compliance_result = 'Görev admin tarafından yeniden aktif edildi'
  where id = p_task_id
    and lower(coalesce(workflow_status, status, '')) in ('iptal edildi', 'iptal')
  returning * into v_task;

  if not found then
    raise exception 'İptal edilmiş görev bulunamadı.' using errcode = 'P0002';
  end if;

  return v_task;
end;
$$;

revoke all on function public.reactivate_cancelled_task(bigint) from public;
grant execute on function public.reactivate_cancelled_task(bigint) to authenticated;

commit;
