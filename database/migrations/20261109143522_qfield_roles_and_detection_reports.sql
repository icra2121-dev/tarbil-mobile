alter table public.profiles
  add constraint profiles_role_admin_inspector_only
  check (role in ('admin', 'inspector')) not valid;
alter table public.profiles validate constraint profiles_role_admin_inspector_only;

drop policy if exists "qfield managers read import batches" on public.qfield_import_batches;
drop policy if exists "qfield managers create import batches" on public.qfield_import_batches;
drop policy if exists "qfield managers delete own import batches" on public.qfield_import_batches;
drop policy if exists "qfield admins read import batches" on public.qfield_import_batches;
drop policy if exists "qfield admins create import batches" on public.qfield_import_batches;
drop policy if exists "qfield admins delete own import batches" on public.qfield_import_batches;

create policy "qfield admins read import batches"
  on public.qfield_import_batches for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
      and p.is_active is true and coalesce(p.status, 'active') <> 'passive'
  ));
create policy "qfield admins create import batches"
  on public.qfield_import_batches for insert to authenticated
  with check (
    imported_by = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'
        and p.is_active is true and coalesce(p.status, 'active') <> 'passive'
    )
  );
create policy "qfield admins delete own import batches"
  on public.qfield_import_batches for delete to authenticated
  using (
    imported_by = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'
        and p.is_active is true and coalesce(p.status, 'active') <> 'passive'
    )
  );

drop policy if exists "qfield managers access classifications" on public.qfield_classifications;
drop policy if exists "qfield records read admin inspectors" on public.qfield_classifications;
drop policy if exists "qfield records write admins" on public.qfield_classifications;
create policy "qfield records read admin inspectors"
  on public.qfield_classifications for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('admin', 'inspector')
      and p.is_active is true and coalesce(p.status, 'active') <> 'passive'
  ));
create policy "qfield records write admins"
  on public.qfield_classifications for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
      and p.is_active is true and coalesce(p.status, 'active') <> 'passive'
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
      and p.is_active is true and coalesce(p.status, 'active') <> 'passive'
  ));

create table if not exists public.standalone_detection_reports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete restrict,
  report_data jsonb not null,
  coordinate_points jsonb not null check (
    jsonb_typeof(coordinate_points) = 'array'
    and jsonb_array_length(coordinate_points) between 3 and 8
  ),
  created_at timestamptz not null default now()
);
create index if not exists standalone_detection_reports_created_idx
  on public.standalone_detection_reports(created_at desc);
create index if not exists standalone_detection_reports_created_by_idx
  on public.standalone_detection_reports(created_by);
alter table public.standalone_detection_reports enable row level security;
revoke all on public.standalone_detection_reports from anon, authenticated;
grant select, insert on public.standalone_detection_reports to authenticated;
create policy "detection reports read admin inspectors"
  on public.standalone_detection_reports for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('admin', 'inspector')
      and p.is_active is true and coalesce(p.status, 'active') <> 'passive'
  ));
create policy "detection reports create admin inspectors"
  on public.standalone_detection_reports for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role in ('admin', 'inspector')
        and p.is_active is true and coalesce(p.status, 'active') <> 'passive'
    )
  );

alter table public.profiles alter column role set not null;
