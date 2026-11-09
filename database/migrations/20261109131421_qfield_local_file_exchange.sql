create table if not exists public.qfield_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_sha256 text not null unique check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null,
  source_layer text not null,
  feature_count integer not null check (feature_count >= 0),
  matched_count integer not null check (matched_count >= 0),
  unmatched_count integer not null check (unmatched_count >= 0),
  missing_identifier_count integer not null check (missing_identifier_count >= 0),
  imported_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (matched_count + unmatched_count = feature_count),
  check (missing_identifier_count <= unmatched_count)
);

create table if not exists public.qfield_classifications (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.qfield_import_batches(id) on delete cascade,
  source_fid bigint not null,
  qfield_id text,
  unit_no text,
  matched_kobuks_unit_id bigint references public.kobuks_units(id) on delete set null,
  area_m2 numeric,
  unit_type text,
  construction_age text,
  foundation_concrete text,
  cover_type text,
  roof_type text,
  roof_width numeric,
  gutter_height numeric,
  ventilation_type text,
  profile_material text,
  profile_structure text,
  heating_type text,
  automation_type text,
  cultivation_type text,
  score numeric,
  judgment text,
  district text,
  neighborhood text,
  geometry_geojson jsonb not null,
  created_at timestamptz not null default now(),
  unique (import_batch_id, source_fid)
);

create index if not exists qfield_classifications_batch_idx
  on public.qfield_classifications(import_batch_id);
create index if not exists qfield_classifications_unit_no_idx
  on public.qfield_classifications(unit_no);
create index if not exists qfield_classifications_kobuks_unit_idx
  on public.qfield_classifications(matched_kobuks_unit_id);

alter table public.qfield_import_batches enable row level security;
alter table public.qfield_classifications enable row level security;

revoke all on public.qfield_import_batches from anon, authenticated;
revoke all on public.qfield_classifications from anon, authenticated;
grant select, insert on public.qfield_import_batches to authenticated;
grant select, insert, update, delete on public.qfield_classifications to authenticated;

drop policy if exists "qfield managers read import batches" on public.qfield_import_batches;
create policy "qfield managers read import batches"
  on public.qfield_import_batches for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'manager')
        and p.is_active is true
        and p.status <> 'passive'
    )
  );

drop policy if exists "qfield managers create import batches" on public.qfield_import_batches;
create policy "qfield managers create import batches"
  on public.qfield_import_batches for insert to authenticated
  with check (
    imported_by = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'manager')
        and p.is_active is true
        and p.status <> 'passive'
    )
  );

drop policy if exists "qfield managers access classifications" on public.qfield_classifications;
create policy "qfield managers access classifications"
  on public.qfield_classifications for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'manager')
        and p.is_active is true
        and p.status <> 'passive'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'manager')
        and p.is_active is true
        and p.status <> 'passive'
    )
  );
