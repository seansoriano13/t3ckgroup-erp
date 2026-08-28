-- ==============================================================================
-- 0057_flow_snapshots.sql
--
-- Flow Snapshots (issue #36 — Flow Canvas; ADR 0006).
-- Each lock snapshots the entire flow (Sale Type, Stages, edges, Actions, 
-- Conditions, notes, Won Stage).
-- 
-- A flow snapshot represents a frozen point in time that the Operations Manager 
-- and Boss agreed upon. It contains the JSON configuration that can be emitted
-- as artefacts and promoted to other environments.
-- ==============================================================================

create table if not exists public.flow_snapshots (
  id            uuid primary key default gen_random_uuid(),
  flow_id       uuid not null references public.sales_flows (id) on delete cascade,
  version       integer not null,
  snapshot_data jsonb not null,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.employees (id),
  
  constraint flow_snapshots_version_unique unique (flow_id, version)
);

-- ── RLS — configuration: everyone reads, Super Admin writes ─────────────────

alter table public.flow_snapshots enable row level security;

drop policy if exists flow_snapshots_read on public.flow_snapshots;
create policy flow_snapshots_read on public.flow_snapshots
  for select to authenticated using (true);

drop policy if exists flow_snapshots_write on public.flow_snapshots;
create policy flow_snapshots_write on public.flow_snapshots
  for insert to authenticated
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  );

-- We don't allow updates or deletes on snapshots by anyone (even super admins). 
-- They are an immutable audit log of locked configurations.
