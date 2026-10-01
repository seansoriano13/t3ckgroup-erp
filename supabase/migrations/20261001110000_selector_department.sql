-- A "Department" selector for Always sees, Always edits and Journey viewers.
--
-- The `team` selector matches Sub-department only, so "Everyone in SALES" missed
-- every Sales employee whose Sub-department is blank or another value (on
-- staging, 9 of 11). `department` matches `employees.department` instead, at
-- read time, so later hires are covered too. Same body as 20260930050000 plus
-- the one new branch; `resolvePeople` (src/utils/resolvePeople.js) is its pure
-- mirror.

create or replace function public.sor_selector_covers(
  p_selector jsonb,
  p_opp public.sales_opportunities,
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select case p_selector->>'type'
    when 'everyone' then exists (
      select 1 from public.employees e
      where e.id = p_employee_id
        and coalesce(e.is_deleted, false) = false
    )
    when 'employee' then (p_selector->>'id')::uuid = p_employee_id
    when 'group' then exists (
      select 1 from public.employee_group_member_ids((p_selector->>'id')::uuid) gm
      where gm = p_employee_id
    )
    when 'team' then exists (
      select 1 from public.employees e
      where e.id = p_employee_id
        and upper(trim(e.sub_department)) = upper(trim(p_selector->>'team'))
    )
    when 'department' then exists (
      select 1 from public.employees e
      where e.id = p_employee_id
        and coalesce(e.is_deleted, false) = false
        and nullif(upper(trim(p_selector->>'department')), '') is not null
        and upper(trim(e.department)) = upper(trim(p_selector->>'department'))
    )
    when 'role' then (
      (p_selector->>'role' = 'deal_owner' and p_opp.deal_owner_id = p_employee_id)
      or (p_selector->>'role' = 'closing_sales' and p_opp.closing_sales_id = p_employee_id)
      or (p_selector->>'role' = 'sales_director' and p_opp.sales_director_id = p_employee_id)
      or (p_selector->>'role' = 'registrar' and p_opp.registered_by = p_employee_id)
      or (
        p_selector->>'role' = 'support_sales'
        and (p_opp.support_sales_1_id = p_employee_id or p_opp.support_sales_2_id = p_employee_id)
      )
    )
    else false
  end
$function$;
