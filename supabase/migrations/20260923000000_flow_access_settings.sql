-- Issue #292 (part of #208, ADR 0021) — Access configuration: flow-level
-- settings and the Stage panel's Access tab.
--
-- Configuration only — no SOR read/write behavior changes here. Two tables,
-- shaped like flow_stage_follow_ups (one row per owner, `jsonb`/array
-- columns), gated the same way #291 gated every other Flow Canvas table:
-- writes require is_super_admin() or can_edit_sales_flows(), reads stay open
-- to any signed-in employee.
--
-- `flow_access_settings` (flow_id primary key):
--   always_sees      — selectors (resolvePeople.js) who always sees every
--                       SOR of this Sale Type, regardless of Stage.
--   journey_viewers  — selectors, or null meaning "Deal Team plus Always
--                       sees" — the default before anyone narrows it.
--
-- `flow_stage_access` (stage_id primary key):
--   shut_out_roles      — Deal Team role keys (resolvePeople.js's
--                          DEAL_TEAM_ROLES) unticked for this Stage.
--   excluded_group_ids  — Employee Group ids shut out of this Stage.

create table if not exists public.flow_access_settings (
  flow_id         uuid primary key references public.sales_flows (id) on delete cascade,
  always_sees     jsonb not null default '[]'::jsonb,
  journey_viewers jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.flow_access_settings enable row level security;

drop policy if exists flow_access_settings_read on public.flow_access_settings;
create policy flow_access_settings_read on public.flow_access_settings
  for select to authenticated
  using (true);

drop policy if exists flow_access_settings_write on public.flow_access_settings;
create policy flow_access_settings_write on public.flow_access_settings
  for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());

create table if not exists public.flow_stage_access (
  stage_id           uuid primary key references public.flow_stages (id) on delete cascade,
  shut_out_roles     text[] not null default '{}',
  excluded_group_ids uuid[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.flow_stage_access enable row level security;

drop policy if exists flow_stage_access_read on public.flow_stage_access;
create policy flow_stage_access_read on public.flow_stage_access
  for select to authenticated
  using (true);

drop policy if exists flow_stage_access_write on public.flow_stage_access;
create policy flow_stage_access_write on public.flow_stage_access
  for all to authenticated
  using (is_super_admin() or can_edit_sales_flows())
  with check (is_super_admin() or can_edit_sales_flows());
