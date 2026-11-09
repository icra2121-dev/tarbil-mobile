drop policy if exists "qfield admins read import batches" on public.qfield_import_batches;
create policy "qfield admins and inspectors read import batches"
  on public.qfield_import_batches for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('admin', 'inspector')
      and p.is_active is true and coalesce(p.status, 'active') <> 'passive'
  ));
