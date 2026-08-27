-- ==============================================================================
-- 0051_flow_stage_requirements.sql
--
-- Merging the Stage Gate Engine (ADR 0006) into Flow Stages.
-- 
-- The original stage_requirements (0041) was keyed to crm_pipeline_stages(code)
-- because Sales Flows didn't exist yet. With ADR 0006, the old pipeline is
-- deprecated and flows are per-sale-type graphs of `flow_stages`.
--
-- This migration drops the old tables and recreates them, pointing to 
-- `flow_stages(id)`. Because the pipeline shapes are fundamentally incompatible 
-- (global line vs per-type graph), old stage gate configs are intentionally dropped.
--
-- SAFE TO RUN AT ANY TIME: The feature was in scaffolding and not actively deployed.
-- ==============================================================================

drop table if exists public.sor_requirement_status cascade;
drop table if exists public.stage_requirements cascade;

create table public.stage_requirements (
  id           uuid primary key default gen_random_uuid(),
  stage_id     uuid not null references public.flow_stages (id) on delete cascade,
  kind         text not null,
  label        text not null,
  is_required  boolean not null default true,
  sort_order   integer not null default 0,
  config       jsonb not null default '{}'::jsonb,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint stage_requirements_kind_chk check (kind in (
    'attachment', 'field', 'tickbox', 'assignment', 'deadline'
  ))
);

create index stage_requirements_stage_idx
  on public.stage_requirements (stage_id, sort_order);

create table public.sor_requirement_status (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.sales_opportunities (id) on delete cascade,
  requirement_id uuid not null references public.stage_requirements (id) on delete cascade,
  satisfied_by   uuid references public.employees (id),
  satisfied_at   timestamptz not null default now(),

  constraint sor_requirement_status_unique unique (opportunity_id, requirement_id)
);

create index sor_requirement_status_opp_idx
  on public.sor_requirement_status (opportunity_id);

-- ── RLS — stage_requirements: configuration, Super-Admin write only ────────
alter table public.stage_requirements enable row level security;

create policy stage_requirements_read on public.stage_requirements
  for select to authenticated using (true);

create policy stage_requirements_write on public.stage_requirements
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

-- sor_requirement_status deliberately has no RLS block, matching sales_opportunity_logs.
-- Authorization is enforced at the service layer where the write actually happens.
