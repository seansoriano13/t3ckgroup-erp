-- ADR 0021 lists `members` among the SOR child tables that need a visit-aware
-- read policy. It never got one: `sales_opportunity_members_read` still carries
-- the rule written in 20260908101315_server_side_sor_task_visibility.sql, which
-- predates Stage Participants entirely.
--
-- That rule is `sor_can_edit_opportunity(opportunity_id) or is_hr()`, and
-- `sor_can_edit_opportunity` names only the registrar, Deal Owner, Support
-- Sales 1 and 2, the Sales Director, and any head or Super Admin. A Stage
-- Participant is in none of those, so they read zero member rows — including
-- the row that names themselves.
--
-- The visible damage is on the Stage checklist. An Assignment condition is
-- evaluated live against the SOR's members (`evaluateCondition`, the
-- `assignment` case), not from a stored status row. With the member list
-- reading empty, a condition that IS satisfied renders unsatisfied to the very
-- person who was assigned through it: the Deal Owner sees "assigned", the
-- assignee sees "not assigned", on the same deal at the same moment. The
-- screen contradicts itself, which is worse than withholding the data.
--
-- The predicate added here is the one `sor_condition_status_read` already uses
-- for rows that carry no Stage Visit (20260926000000_sor_visit_scoped_reads),
-- so this is the codebase's existing rule for "may this caller see this SOR's
-- working detail", applied to the table that was missed rather than a new one
-- invented for it. `full` is included because an Always-sees viewer who is not
-- Deal Team and not a head reads `full` yet fails `sor_can_edit_opportunity`;
-- they could already open the SOR, so the member list was an inconsistency for
-- them too.
--
-- Not widened to `locked`: a closed window keeps the Sales Reference, the
-- project and the current Stage, and nothing else.

drop policy if exists sales_opportunity_members_read on public.sales_opportunity_members;

create policy sales_opportunity_members_read
  on public.sales_opportunity_members
  for select
  using (
    public.sor_can_edit_opportunity(opportunity_id)
    or public.is_hr()
    or public.sor_access_level(opportunity_id) = any (array['full', 'participant'])
  );
