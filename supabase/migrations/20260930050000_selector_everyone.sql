-- Issue #378 (part of #377) — an "Everyone" selector for Always sees.
--
-- `sor_selector_covers` is the one place that decides whether a selector
-- (employee, group, team, Deal Team role, everyone) covers an employee on a
-- given SOR. `sor_always_sees` and `sor_can_view_journey` resolve through it
-- so a new selector type is added once. `resolvePeople`
-- (src/utils/resolvePeople.js) is its pure mirror.
--
-- `everyone` covers every non-deleted employee, including ones hired after the
-- setting was saved: it is matched at read time, never expanded to ids.

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

comment on function public.sor_selector_covers(jsonb, public.sales_opportunities, uuid) is
  '#378: whether one selector covers an employee on an SOR. The single source '
  'of selector matching for Always sees and Journey viewers.';

create or replace function public.sor_always_sees(p_opp public.sales_opportunities, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.sales_flows f
    join public.flow_access_settings fas on fas.flow_id = f.id
    cross join lateral jsonb_array_elements(coalesce(fas.always_sees, '[]'::jsonb)) as selector
    where f.sale_type_id = p_opp.sale_type_id
      and public.sor_selector_covers(selector, p_opp, p_employee_id)
  )
$function$;

create or replace function public.sor_can_view_journey(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when public.sor_access_level(p_opportunity_id) = 'full' then true
    when public.sor_access_level(p_opportunity_id) != 'participant' then false
    else coalesce((
      select exists (
        select 1
        from public.sales_opportunities o
        join public.sales_flows f on f.sale_type_id = o.sale_type_id
        join public.flow_access_settings fas on fas.flow_id = f.id
        cross join lateral jsonb_array_elements(coalesce(fas.journey_viewers, '[]'::jsonb)) as selector
        where o.id = p_opportunity_id
          and fas.journey_viewers is not null
          and public.sor_selector_covers(selector, o, public.get_employee_id())
      )
    ), false)
  end
$function$;
