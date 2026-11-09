alter table public.notifications
  add column if not exists user_id uuid,
  add column if not exists task_id bigint,
  add column if not exists type text not null default 'task_assigned',
  add column if not exists read boolean not null default false,
  add column if not exists data jsonb not null default '{}'::jsonb;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
grant select, insert, update, delete on public.notifications to authenticated;

drop policy if exists "notifications authenticated access" on public.notifications;
drop policy if exists "authenticated users manage notifications" on public.notifications;
create policy "authenticated users manage notifications"
  on public.notifications for all to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );

create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);
