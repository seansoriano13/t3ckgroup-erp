-- ==============================================================================
-- 0015_group_task_checklist_column.sql
--
-- Adds committee_task_members.checklist so group task assignments can carry a
-- description AND a checklist, the way regular tasks already do
-- (tasks.task_description + tasks.checklist).
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * The column is nullable with no default, so this is a catalog-only change.
--     No table rewrite, no lengthy lock.
--   * No existing row is modified.
--   * Older frontends do not select the column and are unaffected.
--
-- Run this one BEFORE deploying the group task frontend — groupTaskService
-- selects `checklist`, and PostgREST rejects the entire query if the column is
-- missing, which returns an empty group task list rather than a partial one.
--
-- The data conversion is deliberately NOT here. It rewrites task_description
-- and would blank out assignments for any client still running the pre-split
-- build, so it lives in 0016 and must run after the deploy. See that file.
--
-- Idempotent: safe to re-run.
-- ==============================================================================

alter table public.committee_task_members
  add column if not exists checklist jsonb;
