-- #129 / #130 / #131: move read visibility for sales_opportunities, tasks and
-- committee_tasks (+ member rows) to the server. The client-side filtering
-- that used to be the only guard stays in place as an optimisation.

-- ===========================================================================
-- #130: sales_opportunities read narrows to the existing edit predicate
-- ===========================================================================
-- sor_can_edit_opportunity() already expresses "registrar, deal owner, either
-- supporting salesperson, sales director, or a head/Super Admin" as a single
-- security-definer helper, and every SOR child table's read policy below
-- reuses it. sales_opportunities' own read policy cannot: Postgres checks a
-- table's SELECT policy against an INSERT's RETURNING output using the
-- statement's own snapshot, which does not yet see a row that same statement
-- just inserted. sor_can_edit_opportunity() re-queries sales_opportunities to
-- do its check, so calling it from sales_opportunities' own read policy made
-- every `insert ... returning` on this table fail with a false RLS violation
-- — registering an SOR would have stopped working entirely. The predicate is
-- inlined here instead, identical in substance to sor_update plus HR, stated
-- explicitly rather than inherited.

drop policy if exists "sor_read" on public."sales_opportunities";
create policy "sor_read" on public."sales_opportunities"
  as permissive
  for select
  to authenticated
  using (
    registered_by = public.get_employee_id()
    or deal_owner_id = public.get_employee_id()
    or support_sales_1_id = public.get_employee_id()
    or support_sales_2_id = public.get_employee_id()
    or sales_director_id = public.get_employee_id()
    or public.is_head()
    or public.is_super_admin()
    or public.is_hr()
  );

-- Child tables move onto the same helper so a child cannot be read when its
-- parent is unreachable.

drop policy if exists "sor_items_read" on public."sales_opportunity_items";
create policy "sor_items_read" on public."sales_opportunity_items"
  as permissive
  for select
  to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id) or public.is_hr());

drop policy if exists "sor_log_read" on public."sales_opportunity_logs";
create policy "sor_log_read" on public."sales_opportunity_logs"
  as permissive
  for select
  to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id) or public.is_hr());

-- sales_opportunity_members has never had row level security enabled at all,
-- so its "using (true)" read policy has been decorative. It gets protected
-- here for the first time, in line with the other SOR children.
alter table public."sales_opportunity_members" enable row level security;

drop policy if exists "sales_opportunity_members_read" on public."sales_opportunity_members";
create policy "sales_opportunity_members_read" on public."sales_opportunity_members"
  as permissive
  for select
  to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id) or public.is_hr());

drop policy if exists "sor_inclusions_read" on public."sor_inclusions";
create policy "sor_inclusions_read" on public."sor_inclusions"
  as permissive
  for select
  to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id) or public.is_hr());

drop policy if exists "sor_procurement_read" on public."sor_procurement_requests";
create policy "sor_procurement_read" on public."sor_procurement_requests"
  as permissive
  for select
  to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id) or public.is_hr());

drop policy if exists "sor_project_evaluations_read" on public."sor_project_evaluations";
create policy "sor_project_evaluations_read" on public."sor_project_evaluations"
  as permissive
  for select
  to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id) or public.is_hr());

drop policy if exists "sor_purchase_order_links_read" on public."sor_purchase_order_links";
create policy "sor_purchase_order_links_read" on public."sor_purchase_order_links"
  as permissive
  for select
  to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id) or public.is_hr());

-- Canvasses and their offers reach an opportunity indirectly (through an
-- inclusion or a procurement request), and their write side is already
-- gated on the purchasing flow rather than on opportunity participation.
-- Read visibility follows the same shape: a purchasing-flow holder keeps
-- seeing everything they can act on, and everyone else's visibility follows
-- the opportunity they resolve to.

drop policy if exists "sor_canvasses_read" on public."sor_canvasses";
create policy "sor_canvasses_read" on public."sor_canvasses"
  as permissive
  for select
  to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.has_purchasing_flow
    )
    or public.sor_can_edit_opportunity(
      coalesce(
        (select si.opportunity_id from public.sor_inclusions si where si.id = sor_canvasses.inclusion_id),
        (select pr.opportunity_id from public.sor_procurement_requests pr where pr.id = sor_canvasses.procurement_request_id)
      )
    )
  );

drop policy if exists "sor_canvass_offers_read" on public."sor_canvass_offers";
create policy "sor_canvass_offers_read" on public."sor_canvass_offers"
  as permissive
  for select
  to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.has_purchasing_flow
    )
    or exists (
      select 1 from public.sor_canvasses c
      where c.id = sor_canvass_offers.canvass_id
        and public.sor_can_edit_opportunity(
          coalesce(
            (select si.opportunity_id from public.sor_inclusions si where si.id = c.inclusion_id),
            (select pr.opportunity_id from public.sor_procurement_requests pr where pr.id = c.procurement_request_id)
          )
        )
    )
  );

-- ===========================================================================
-- #131: tasks and task_activity get the policies they never had in staging
-- ===========================================================================
-- Production already carries these three policies for `tasks`; this brings
-- staging into line by migration instead of leaving the two environments to
-- disagree. Read stays open (matching production) — this is a drift fix, not
-- a visibility narrowing. There is deliberately no delete policy, so no one
-- may delete a task.

alter table public."tasks" enable row level security;

drop policy if exists "Allow public read of tasks" on public."tasks";
create policy "Allow public read of tasks" on public."tasks"
  as permissive
  for select
  to public
  using (true);

drop policy if exists "Users and Managers can insert tasks" on public."tasks";
create policy "Users and Managers can insert tasks" on public."tasks"
  as permissive
  for insert
  to public
  with check (
    logged_by = public.get_employee_id()
    or public.is_head()
    or public.is_hr()
    or public.is_super_admin()
  );

drop policy if exists "Users and Managers can update tasks" on public."tasks";
create policy "Users and Managers can update tasks" on public."tasks"
  as permissive
  for update
  to public
  using (
    logged_by = public.get_employee_id()
    or public.is_head()
    or public.is_hr()
    or public.is_super_admin()
  );

-- task_activity: production also carries insert and select policies staging
-- never had (RLS itself was never switched on here). Reconciled the same
-- way — same shape production already has, not a new predicate.
alter table public."task_activity" enable row level security;

drop policy if exists "Enable insert for authenticated users" on public."task_activity";
create policy "Enable insert for authenticated users" on public."task_activity"
  as permissive
  for insert
  to public
  with check (true);

drop policy if exists "Enable read access for all users" on public."task_activity";
create policy "Enable read access for all users" on public."task_activity"
  as permissive
  for select
  to public
  using (true);

-- ===========================================================================
-- #131: committee_tasks and committee_task_members get real policies
-- ===========================================================================
-- Visibility matches what the service already applies client-side in
-- groupTaskService.getGroupTasks: the task's creator, any named member, or a
-- Super Admin. Expressed once as a security-definer helper so a member row
-- follows the same rule as its parent task.

-- Used by committee_task_members below, which reaches its parent task through
-- a different table and so has no self-reference problem. committee_tasks'
-- own read policy cannot use this helper for the same reason sales_opportunities'
-- read policy is inlined above: the helper re-queries committee_tasks, and an
-- `insert ... returning` or `update ... returning` on committee_tasks itself
-- runs against a snapshot that cannot yet see that statement's own row.
CREATE OR REPLACE FUNCTION public.committee_task_visible(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.committee_tasks ct
    where ct.id = p_task_id
      and (
        ct.created_by = public.get_employee_id()
        or public.is_super_admin()
        or exists (
          select 1 from public.committee_task_members ctm
          where ctm.committee_task_id = ct.id
            and ctm.employee_id = public.get_employee_id()
        )
      )
  )
$function$;

drop policy if exists "Allow select for authenticated users" on public."committee_tasks";
create policy "committee_tasks_read" on public."committee_tasks"
  as permissive
  for select
  to authenticated
  using (
    created_by = public.get_employee_id()
    or public.is_super_admin()
    or exists (
      select 1 from public.committee_task_members ctm
      where ctm.committee_task_id = committee_tasks.id
        and ctm.employee_id = public.get_employee_id()
    )
  );

-- Two insert policies existed side by side (one "to authenticated", one "to
-- public"), both `with check (true)`. Both are replaced by one rule: only the
-- named creator may insert a Group Task naming themselves as its creator.
drop policy if exists "Allow insert for authenticated users" on public."committee_tasks";
drop policy if exists "Enable insert" on public."committee_tasks";
create policy "committee_tasks_insert" on public."committee_tasks"
  as permissive
  for insert
  to authenticated
  with check (created_by = public.get_employee_id());

drop policy if exists "Allow select for authenticated users" on public."committee_task_members";
create policy "committee_task_members_read" on public."committee_task_members"
  as permissive
  for select
  to authenticated
  using (public.committee_task_visible(committee_task_id));

-- A member row is created alongside its task by that task's creator
-- (groupTaskService.createGroupTask / addMemberToTask both insert here as
-- whoever owns the parent task), so the insert rule constrains the same
-- creator rather than the row's own employee_id, which names whoever is
-- being added, not whoever is doing the adding.
drop policy if exists "Allow insert for authenticated users" on public."committee_task_members";
create policy "committee_task_members_insert" on public."committee_task_members"
  as permissive
  for insert
  to authenticated
  with check (
    public.is_super_admin()
    or exists (
      select 1 from public.committee_tasks ct
      where ct.id = committee_task_id
        and ct.created_by = public.get_employee_id()
    )
  );
