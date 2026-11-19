-- Spec #1104 / ticket #1107: Purchasing must not see the Final Offer or the ABC on the bid panel.
-- Cause: costing_tier sent 'closed_book' to anyone costing_is_open() covers, and costing_is_open()
-- (20261102170000) includes has_purchasing_access(). So a purchaser with no part in the deal read the
-- Closed Book, which carries final_offer_total / abc_total, and BidDecisionPanel showed them.
-- Now: Super Admin, the Final Acquire (decider) list and the Deal Team read the Closed Book; anyone
-- else with Purchasing access reads 'cost' (no Final Offer, no Bid Decision), ahead of the Always sees
-- 'price' fallback. costing_is_open() itself is unchanged (it still gates the bands).

create or replace function public.costing_tier(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.costing_is_standalone(p_opportunity_id) then public.costing_standalone_tier(p_opportunity_id)
    when not exists (select 1 from public.sales_opportunities o where o.id = p_opportunity_id) then null
    when coalesce(public.is_super_admin(), false)
      or public.costing_on_list('final_acquire')
      or exists (
        select 1 from public.sales_opportunities o
        where o.id = p_opportunity_id and public.sor_is_deal_team(o, public.get_employee_id())
      ) then 'closed_book'
    when public.has_purchasing_access() then 'cost'
    when exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id and public.sor_always_sees(o, public.get_employee_id())
    ) then 'price'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    when exists (
      select 1 from public.costing_matrices m
      where m.opportunity_id = p_opportunity_id
        and (
          m.technical_incharge_id = public.get_employee_id()
          or public.costing_on_list('evaluation')
        )
    ) then 'participant'
    else null
  end
$$;
