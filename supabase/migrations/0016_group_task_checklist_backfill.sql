-- ==============================================================================
-- 0016_group_task_checklist_backfill.sql
--
-- Moves serialised checklists out of committee_task_members.task_description
-- and into the checklist column added by 0015.
--
-- ⚠ RUN THIS ONLY AFTER THE NEW GROUP TASK FRONTEND IS DEPLOYED EVERYWHERE.
--
-- This is the half that rewrites existing rows. A client still running the
-- pre-split build reads checklists out of task_description by sniffing for a
-- leading '['. Once this migration empties that column, such a client renders
-- those assignments as blank — in the task card, the detail modal and the
-- rating modal alike. Nothing is lost (the items move to `checklist`), but the
-- old build cannot see them.
--
-- The current frontend reads through resolveAssignment() in
-- src/pages/group-tasks/utils/checklist.js, which checks the checklist column
-- and falls back to task_description. It therefore renders correctly both
-- before and after this migration, so there is no rush to run it — and no
-- window where the app is wrong.
--
-- Mirrors migrate_checklist.sql, which did the same for the tasks table.
-- Idempotent: safe to re-run.
-- Runs as one transaction, so a failure part-way cannot leave some assignments
-- moved and others not.
-- ==============================================================================

begin;

-- migrate_checklist.sql cast task_description::jsonb directly and noted in a
-- comment that a malformed string starting with '[' or '{' would abort the
-- whole UPDATE. Rather than inherit that, each row is converted inside its own
-- exception block: a row that does not hold valid JSON is left exactly as it
-- is, as plain text, which is the correct reading of it anyway.
do $$
declare
  r record;
  parsed jsonb;
  is_json boolean;
  moved int := 0;
  skipped int := 0;
begin
  for r in
    select id, task_description
    from public.committee_task_members
    where checklist is null
      and task_description is not null
      and task_description <> ''
      and (
        left(btrim(task_description), 1) = '[' or
        left(btrim(task_description), 1) = '{'
      )
  loop
    is_json := true;
    begin
      parsed := r.task_description::jsonb;
    exception when others then
      -- Not valid JSON despite the leading bracket. Leave the row untouched.
      is_json := false;
    end;

    if not is_json then
      skipped := skipped + 1;
      continue;
    end if;

    -- Legacy shape {title, items} stored the array under `items`; the newer
    -- shape is a bare array. ChecklistTaskInput already reads both, but only
    -- the array form is worth carrying forward into the new column.
    -- task_description is NOT NULL in production, so the emptied value has to
    -- be '' rather than NULL.
    if jsonb_typeof(parsed) = 'array' then
      update public.committee_task_members
      set checklist = parsed,
          task_description = ''
      where id = r.id;
      moved := moved + 1;
    elsif jsonb_typeof(parsed) = 'object' and jsonb_typeof(parsed -> 'items') = 'array' then
      update public.committee_task_members
      set checklist = parsed -> 'items',
          task_description = ''
      where id = r.id;
      moved := moved + 1;
    end if;
  end loop;

  raise notice
    'Moved % checklist(s) into the checklist column; left % row(s) as plain text.',
    moved, skipped;
end $$;

commit;
