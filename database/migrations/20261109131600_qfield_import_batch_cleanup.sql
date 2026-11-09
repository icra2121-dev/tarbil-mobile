grant delete on public.qfield_import_batches to authenticated;

drop policy if exists "qfield managers delete own import batches" on public.qfield_import_batches;
create policy "qfield managers delete own import batches"
  on public.qfield_import_batches for delete to authenticated
  using (
    imported_by = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'manager')
        and p.is_active is true
        and p.status <> 'passive'
    )
  );
