-- A "Require confirmation before running" Decider set to "Everyone in <X>
-- department" (a `department` selector, resolvePeople.js) never let anyone in
-- that department decide: this gate knew employees, groups, Teams
-- (sub_department) and Deal Team roles only. Same function as
-- 20260930220000_revert_restores_skipped_action.sql, plus the department
-- branch, matched the way resolvePeople.js matches it (trimmed, upper-cased).
create or replace function public.sor_decide_action_run(
  p_run_id uuid,
  p_decision text,
  p_actor_id uuid
) returns public.sor_action_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sor_action_runs;
  v_opportunity public.sales_opportunities;
  v_selector jsonb;
  v_allowed boolean := false;
begin
  if p_decision not in ('create', 'skip') then
    raise exception 'sor_decide_action_run: invalid decision %', p_decision;
  end if;

  select * into v_row from public.sor_action_runs where id = p_run_id;
  if v_row.id is null then
    raise exception 'sor_decide_action_run: run % not found', p_run_id;
  end if;

  if v_row.outcome <> 'pending' then
    raise exception 'sor_decide_action_run: run % already decided', p_run_id;
  end if;
  if v_row.held_at is not null then
    raise exception 'sor_decide_action_run: run % is on hold, not decidable', p_run_id;
  end if;
  if v_row.closed_off_at is not null then
    raise exception 'sor_decide_action_run: run % is closed off, not decidable', p_run_id;
  end if;

  select * into v_opportunity from public.sales_opportunities where id = v_row.opportunity_id;

  if v_row.decider is null or jsonb_array_length(v_row.decider) = 0 then
    v_allowed := false;
  else
    for v_selector in select * from jsonb_array_elements(v_row.decider)
    loop
      if v_selector->>'type' = 'employee' and (v_selector->>'id')::uuid = p_actor_id then
        v_allowed := true;
      elsif v_selector->>'type' = 'group'
        and exists (
          select 1 from public.employee_group_members egm
          where egm.group_id = (v_selector->>'id')::uuid
            and egm.employee_id = p_actor_id
        ) then
        v_allowed := true;
      elsif v_selector->>'type' = 'team'
        and exists (
          select 1 from public.employees e
          where e.id = p_actor_id
            and upper(trim(e.sub_department)) = upper(trim(v_selector->>'team'))
        ) then
        v_allowed := true;
      elsif v_selector->>'type' = 'department'
        and exists (
          select 1 from public.employees e
          where e.id = p_actor_id
            and nullif(upper(trim(e.department)), '') = upper(trim(v_selector->>'department'))
        ) then
        v_allowed := true;
      elsif v_selector->>'type' = 'role' and v_opportunity.id is not null then
        case v_selector->>'role'
          when 'deal_owner' then
            v_allowed := v_opportunity.deal_owner_id = p_actor_id;
          when 'closing_sales' then
            v_allowed := v_opportunity.closing_sales_id = p_actor_id;
          when 'support_sales' then
            v_allowed := v_opportunity.support_sales_1_id = p_actor_id
              or v_opportunity.support_sales_2_id = p_actor_id;
          when 'sales_director' then
            v_allowed := v_opportunity.sales_director_id = p_actor_id;
          when 'registrar' then
            v_allowed := v_opportunity.registered_by = p_actor_id;
          else
            v_allowed := false;
        end case;
      end if;
      exit when v_allowed;
    end loop;
  end if;

  if not v_allowed then
    raise exception 'sor_decide_action_run: actor % is not a decider for run %', p_actor_id, p_run_id;
  end if;

  update public.sor_action_runs
  set decided_by = p_actor_id,
      decided_at = now(),
      outcome = case when p_decision = 'create' then 'created' else 'skipped' end
  where id = p_run_id
  returning * into v_row;


  return v_row;
end;
$$;
