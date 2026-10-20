-- Выполни этот SQL в Supabase → SQL Editor → New query → Run.
create table if not exists public.shared_price (
  id integer primary key check (id = 1),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.shared_price enable row level security;
grant select on public.shared_price to anon, authenticated;
grant insert, update on public.shared_price to authenticated;
drop policy if exists "Anyone can read shared price" on public.shared_price;
create policy "Anyone can read shared price" on public.shared_price for select to anon, authenticated using (true);
drop policy if exists "Only owner email can insert shared price" on public.shared_price;
create policy "Only owner email can insert shared price" on public.shared_price for insert to authenticated
  with check ((auth.jwt() ->> 'email') = 'REPLACE_WITH_OWNER_EMAIL');
drop policy if exists "Only owner email can update shared price" on public.shared_price;
create policy "Only owner email can update shared price" on public.shared_price for update to authenticated
  using ((auth.jwt() ->> 'email') = 'REPLACE_WITH_OWNER_EMAIL')
  with check ((auth.jwt() ->> 'email') = 'REPLACE_WITH_OWNER_EMAIL');
