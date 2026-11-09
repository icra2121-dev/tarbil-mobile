alter table public.kobuks_production enable row level security;
alter table public.kobuks_producers enable row level security;
alter table public.kobuks_units enable row level security;
alter table public.task_evidence enable row level security;

drop policy if exists "authenticated can read kobuks production" on public.kobuks_production;
create policy "authenticated can read kobuks production"
  on public.kobuks_production for select to authenticated using (true);

drop policy if exists "authenticated can read kobuks producers" on public.kobuks_producers;
create policy "authenticated can read kobuks producers"
  on public.kobuks_producers for select to authenticated using (true);

drop policy if exists "authenticated can read kobuks units" on public.kobuks_units;
create policy "authenticated can read kobuks units"
  on public.kobuks_units for select to authenticated using (true);

drop policy if exists "authenticated can manage task evidence" on public.task_evidence;
create policy "authenticated can manage task evidence"
  on public.task_evidence for all to authenticated using (true) with check (true);
