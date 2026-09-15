-- Issue #203, story 38 — drops sor_project_evaluations, but only if it holds
-- no rows: Project Evaluation is a feature nobody used (the company keeps
-- that judgment in a Google Sheet), but "unused" is a claim to verify, not
-- assume, before destroying a table. If a row exists, this raises and names
-- the count instead of dropping anything — re-run once whatever is in there
-- has been dealt with (exported, or confirmed truly abandoned).
--
-- stage_conditions_kind_chk is left alone: it still accepts 'project_evaluation'
-- so any stage_conditions row already carrying that kind (there should be
-- none live — the picker no longer offers it, and issue #203 didn't need to
-- convert them the way it converts `field`, since existence-only Project
-- Evaluation gating was never load-bearing) stays valid history.
--
-- Production DDL runs through the manual migration workflow (see
-- MEMORY.md — "Prod DB migration is manual"): check prod's live row count
-- with this migration's own guard before running it there.

do $$
declare
  v_row_count integer;
begin
  if to_regclass('public.sor_project_evaluations') is null then
    return;
  end if;

  select count(*) into v_row_count from public.sor_project_evaluations;

  if v_row_count > 0 then
    raise exception 'sor_project_evaluations still holds % row(s) — refusing to drop.', v_row_count;
  end if;

  drop table public.sor_project_evaluations;
end $$;
