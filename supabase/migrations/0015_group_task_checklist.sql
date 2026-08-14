-- ==============================================================================
-- 0015_group_task_checklist.sql
--
-- Gives group task members a description AND a checklist, matching how regular
-- tasks already work (tasks.task_description + tasks.checklist).
--
-- Until now committee_task_members.task_description held EITHER plain text OR a
-- serialised JSON checklist array, and the UI switched between them with a
-- throwaway toggle. Every read site had to sniff whether the string started
-- with '[' or '{' to know which it was. This splits them apart.
--
-- Mirrors migrate_checklist.sql, which did the same for the tasks table.
-- Idempotent: safe to re-run.
-- ==============================================================================

-- ── 1. Add the checklist column ──────────────────────────────────────────────
alter table public.committee_task_members
  add column if not exists checklist jsonb;

-- ── 2. Move JSON checklists out of task_description ──────────────────────────
-- migrate_checklist.sql cast task_description::jsonb directly and noted in a
-- comment that a malformed string starting with '[' or '{' would abort the
-- whole UPDATE. Rather than inherit that, each row is converted inside its own
-- exception block: a row that does not hold valid JSON is left exactly as it
-- is, as plain text, which is the correct reading of it anyway.
do $$
declare
  r record;
  parsed jsonb;
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
    begin
      parsed := r.task_description::jsonb;
    exception when others then
      -- Not valid JSON despite the leading bracket. Leave the row untouched.
      continue;
    end;

    -- Legacy shape {title, items} stored the array under `items`; the newer
    -- shape is a bare array. ChecklistTaskInput already reads both, but only
    -- the array form is worth carrying forward into the new column.
    if jsonb_typeof(parsed) = 'array' then
      update public.committee_task_members
      set checklist = parsed,
          task_description = ''
      where id = r.id;
    elsif jsonb_typeof(parsed) = 'object' and jsonb_typeof(parsed -> 'items') = 'array' then
      update public.committee_task_members
      set checklist = parsed -> 'items',
          task_description = ''
      where id = r.id;
    end if;
  end loop;
end $$;
