create table if not exists public.plan_workspaces (
  user_id uuid primary key references auth.users (id) on delete cascade,
  account_name text not null default '',
  subjects jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.plan_workspaces enable row level security;

create policy "Users can read their own plan workspace"
on public.plan_workspaces
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own plan workspace"
on public.plan_workspaces
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own plan workspace"
on public.plan_workspaces
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own plan workspace"
on public.plan_workspaces
for delete
to authenticated
using ((select auth.uid()) = user_id);
