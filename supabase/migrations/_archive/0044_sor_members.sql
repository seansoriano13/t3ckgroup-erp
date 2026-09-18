-- ==============================================================================
-- 0044_sor_members.sql
--
-- SOR Members (docs/crm-pipeline-redesign.md glossary; stage-gate-engine
-- spec's `assignment` requirement kind), ticket 5 of
-- .scratch/stage-gate-engine/issues/.
--
-- Minimal on purpose: this table exists to give the `assignment` requirement
-- kind something real to evaluate against ("someone from a named department
-- is an SOR Member"). It is NOT D29 — membership-gated reads, row-level
-- access control, and "Super Admin bypasses membership" are a separate,
-- much larger piece of work this migration does not attempt. Today every SOR
-- row is still readable by any authenticated user (0001's `using (true)`);
-- this table only tracks who has been added, so `assignment` requirements
-- have something to check.
--
-- Additive and permanent, per the SOR Member glossary entry: no `removed_at`,
-- no delete path. `unique (opportunity_id, employee_id)` makes adding an
-- already-added member a safe no-op rather than a duplicate row.
--
-- No RLS — same convention `sor_requirement_status` (0041) and
-- `sales_opportunity_logs` (0001) already follow: authorization for who may
-- add a member lives in the service layer, not the database.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * One new table — nothing existing selects it.
--   * Idempotent.
-- ==============================================================================

create table if not exists public.sales_opportunity_members (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.sales_opportunities (id) on delete cascade,
  employee_id    uuid not null references public.employees (id),
  added_by       uuid references public.employees (id),
  added_at       timestamptz not null default now(),

  constraint sales_opportunity_members_unique unique (opportunity_id, employee_id)
);

create index if not exists sales_opportunity_members_opp_idx
  on public.sales_opportunity_members (opportunity_id);
