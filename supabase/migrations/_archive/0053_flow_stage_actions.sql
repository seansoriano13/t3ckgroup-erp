-- ==============================================================================
-- 0053_flow_stage_actions.sql
--
-- Flow Stage Actions (Automations).
-- Actions fire automatically when a deal enters a stage, unlike Requirements
-- which block a deal from leaving.
-- ==============================================================================

create table if not exists public.flow_stage_actions (
  id           uuid primary key default gen_random_uuid(),
  stage_id     uuid not null references public.flow_stages (id) on delete cascade,
  kind         text not null,
  config       jsonb not null default '{}'::jsonb,
  sort_order   integer not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint flow_stage_actions_kind_chk check (kind in (
    'create_group_task', 'create_individual_task'
  ))
);

create index if not exists flow_stage_actions_stage_idx
  on public.flow_stage_actions (stage_id, sort_order);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.flow_stage_actions enable row level security;

drop policy if exists flow_stage_actions_read on public.flow_stage_actions;
create policy flow_stage_actions_read on public.flow_stage_actions
  for select to authenticated using (true);

drop policy if exists flow_stage_actions_write on public.flow_stage_actions;
create policy flow_stage_actions_write on public.flow_stage_actions
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  );
