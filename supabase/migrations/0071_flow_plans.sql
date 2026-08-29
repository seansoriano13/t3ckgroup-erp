-- ==============================================================================
-- 0071_flow_plans.sql
--
-- Flow Plans are independent, real-time collaborative sandboxes (FlowCanvas draft mode)
-- They use Yjs CRDTs to sync state and do not touch the active `sales_flows` tables.
-- ==============================================================================

create table if not exists public.flow_plans (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  yjs_state   bytea, -- binary representation of the Yjs document
  created_by  uuid references public.employees (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint flow_plans_name_not_blank check (btrim(name) <> '')
);

-- ── RLS — configuration: everyone can read and write to collaborate ─────────

alter table public.flow_plans enable row level security;

drop policy if exists flow_plans_read on public.flow_plans;
create policy flow_plans_read on public.flow_plans
  for select to authenticated using (true);

drop policy if exists flow_plans_insert on public.flow_plans;
create policy flow_plans_insert on public.flow_plans
  for insert to authenticated
  with check (created_by = public.get_employee_id());

drop policy if exists flow_plans_update on public.flow_plans;
create policy flow_plans_update on public.flow_plans
  for update to authenticated
  using (true)
  with check (true);

drop policy if exists flow_plans_delete on public.flow_plans;
create policy flow_plans_delete on public.flow_plans
  for delete to authenticated
  using (created_by = public.get_employee_id());

-- Broadcast channel for Yjs awareness/presence (if we want to enforce it, though realtime is generally configured at the realtime level, we can ensure the table is in publication if we use Postgres changes, but Yjs usually just uses Supabase Broadcast which doesn't require a table, OR it uses postgres changes on a table. If it uses postgres changes on `flow_plans` for syncing the blob, we need it in the publication).
alter publication supabase_realtime add table public.flow_plans;
