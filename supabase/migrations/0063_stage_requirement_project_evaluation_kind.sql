-- ==============================================================================
-- 0063_stage_requirement_project_evaluation_kind.sql
--
-- A sixth Stage requirement kind (issue #50): 'project_evaluation'. A Super
-- Admin can gate a Stage on a deal simply having a Project Evaluation on
-- record (issue #48) — existence alone satisfies it, sign-off is recorded but
-- never required, matching how the kind's evaluation branch in
-- constants/stageGate.js reads sor_project_evaluations (issue #61).
--
-- Widens the CHECK constraint 0051 defined when Stage Requirements moved onto
-- Flow Stages. No config columns are added: config is already the free-form
-- jsonb every other kind already uses, and this kind's only optional field —
-- a reference link, shown to whoever is blocked — fits inside it exactly the
-- way a `deadline` requirement's `days` already does.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Widens a CHECK constraint only, touches no existing rows.
--   * A frontend deployed before this migration never writes
--     'project_evaluation', so nothing existing is affected.
-- ==============================================================================

alter table public.stage_requirements
  drop constraint if exists stage_requirements_kind_chk;

alter table public.stage_requirements
  add constraint stage_requirements_kind_chk check (kind in (
    'attachment', 'field', 'tickbox', 'assignment', 'deadline', 'project_evaluation'
  ));
