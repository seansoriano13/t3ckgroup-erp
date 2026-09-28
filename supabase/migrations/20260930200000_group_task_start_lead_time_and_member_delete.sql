-- allow-out-of-order: prod hotfix #410 (2026-09-28), already recorded under this name in prod ledger; renaming would orphan it there (#415).
-- Group Task Start Date and Lead Time, and removing a member that actually
-- removes them.
--
-- Start Date is the day the work begins — independent of created_at and of
-- due_date, neither derived from the other. Lead Time is free text on purpose:
-- it holds "120 calendar days" as readily as "Extended", so it is never
-- computed into a date. See CONTEXT.md.
--
-- committee_task_members has never had a DELETE policy (none in the baseline,
-- none since), so under RLS every delete matched zero rows without an error.
-- The app took the missing error for success: it toasted, logged
-- MEMBER_REMOVED to the history, and the member stayed. Who may remove is the
-- same rule as who may add (committee_task_members_insert) and who the detail
-- modal shows the remove button to: the group task's creator, or a Super
-- Admin.

alter table public.committee_tasks
  add column if not exists start_date date;
alter table public.committee_tasks
  add column if not exists lead_time text;

-- Permissive policies OR together, so a DELETE policy this repo doesn't know
-- about (prod's ledger has drifted before) would quietly widen the rule below.
-- Stop rather than guess: the whole migration rolls back and names it.
do $$
declare
  stray text;
begin
  select string_agg(policyname, ', ') into stray
  from pg_policies
  where schemaname = 'public'
    and tablename = 'committee_task_members'
    and cmd in ('DELETE', 'ALL')
    and policyname <> 'committee_task_members_delete';
  if stray is not null then
    raise exception 'committee_task_members already has DELETE policies: %', stray;
  end if;
end
$$;

drop policy if exists "committee_task_members_delete" on public."committee_task_members";
create policy "committee_task_members_delete" on public."committee_task_members"
  as permissive
  for delete
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.committee_tasks ct
      where ct.id = committee_task_members.committee_task_id
        and ct.created_by = public.get_employee_id()
    )
  );
