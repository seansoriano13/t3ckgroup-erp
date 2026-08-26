-- ==============================================================================
-- 0041_stage_requirements.sql
--
-- Schema for the Stage Gate Engine (docs/stage-gate-engine-spec.md, ticket 1
-- of .scratch/stage-gate-engine/issues/). Two tables, and the removal of one
-- that was never a real feature.
--
-- WHAT THIS DOES NOT DO
-- Nothing here reads or writes through `opportunityService.updateStage`, and
-- no Stage gains a requirement — that is a config-service action (ticket 3),
-- not a migration. This is purely the container.
--
-- `stage_requirements` — the configuration. One row per requirement on a
-- Stage. `stage_code` references `crm_pipeline_stages(code)` (not an `_id`
-- column) for the same reason `sales_opportunities.status` does: the stage's
-- primary key IS its code (0033). `config` is a small kind-specific object —
-- see the spec's table under "Two new tables" — deliberately unvalidated by a
-- CHECK, the same way other jsonb configuration in this schema is (e.g.
-- commission_splits' shape). Never a hard delete: `archived_at` is the one
-- escape route (D21), so `is_required` history and past satisfaction survive
-- a rule being retired.
--
-- `sor_requirement_status` — satisfaction, keyed on (opportunity, requirement)
-- so re-entering a Stage reuses rather than re-arming (D31). A row's ABSENCE
-- is meaningful — it is how D41's "never applied" is distinguished from
-- "unsatisfied" — so nothing pre-creates rows on Stage entry; a row exists
-- only once something actually satisfies its requirement.
--
-- RLS follows the same split the rest of this schema already draws:
-- `stage_requirements` is configuration, gated Super-Admin-only exactly like
-- crm_pipeline_stages (0033) and the commission tables (0028).
-- `sor_requirement_status` is written by whatever Deal Owner action satisfies
-- a requirement (attaching a file, filling a field, ticking a box, assigning
-- a member — ticket 5), the same shape as `sales_opportunity_logs`, so it is
-- left without RLS per 0001's documented convention: authorization for that
-- table lives in the service layer, not the database.
--
-- `stage_checkpoints` on `sales_opportunities` is dropped in the same
-- migration. It is an orphan `jsonb` column, holding `[]` on every production
-- row, referenced by no code and no prior migration — an abandoned start on
-- this same feature (Q35 in docs/crm-pipeline-redesign.md). A jsonb blob
-- cannot be joined for "which deals owe this requirement"; the per-requirement
-- rows this migration creates are what that actually needs. `drop column if
-- exists` so this is safe whether or not a given database ever had it tracked.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Two new tables — nothing existing selects them.
--   * The dropped column is unreferenced by every current query; removing it
--     changes nothing any running frontend does.
--   * Idempotent.
-- ==============================================================================

create table if not exists public.stage_requirements (
  id           uuid primary key default gen_random_uuid(),
  stage_code   text not null references public.crm_pipeline_stages (code),
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

create index if not exists stage_requirements_stage_idx
  on public.stage_requirements (stage_code, sort_order);

create table if not exists public.sor_requirement_status (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.sales_opportunities (id) on delete cascade,
  requirement_id uuid not null references public.stage_requirements (id) on delete cascade,
  satisfied_by   uuid references public.employees (id),
  satisfied_at   timestamptz not null default now(),

  constraint sor_requirement_status_unique unique (opportunity_id, requirement_id)
);

create index if not exists sor_requirement_status_opp_idx
  on public.sor_requirement_status (opportunity_id);

alter table public.sales_opportunities
  drop column if exists stage_checkpoints;

-- ── RLS — stage_requirements: configuration, Super-Admin write only ────────
alter table public.stage_requirements enable row level security;

drop policy if exists stage_requirements_read on public.stage_requirements;
create policy stage_requirements_read on public.stage_requirements
  for select to authenticated using (true);

drop policy if exists stage_requirements_write on public.stage_requirements;
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

-- sor_requirement_status deliberately has no RLS block — see header. It
-- behaves like sales_opportunity_logs (0001): authorization for who may
-- satisfy a requirement is enforced where the write actually happens
-- (ticket 5), not at the table.
