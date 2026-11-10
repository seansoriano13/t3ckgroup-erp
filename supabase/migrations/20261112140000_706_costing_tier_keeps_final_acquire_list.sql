-- #706 (spec #699) rebuilt costing_tier from 20261102170000 and so dropped what 20261102180000 had added to
-- it: a member of the Final Acquire list reads the Closed Book on every SOR. Without it the list lost the
-- money columns and costing_set_money refused them ("not allowed"). This puts that line back; everything
-- else is #706's version, so a team member still reads as the participant tier.
create or replace function public.costing_tier(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.sales_opportunities o where o.id = p_opportunity_id) then null
    when public.costing_on_list('final_acquire') or public.costing_is_open(p_opportunity_id) then 'closed_book'
    when exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id
        and (
          public.sor_is_deal_team(o, public.get_employee_id())
          or public.sor_always_sees(o, public.get_employee_id())
        )
    ) then 'price'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    when (public.costing_on_list('evaluation') or public.costing_on_list('team_rrd') or public.costing_on_list('team_ioe'))
      and exists (select 1 from public.costing_matrices m where m.opportunity_id = p_opportunity_id)
    then 'participant'
    else null
  end
$$;
