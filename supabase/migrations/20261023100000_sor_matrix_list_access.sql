-- #545 (spec #544): the Final Acquire list and the Evaluation list can open any SOR that has a
-- Costing Matrix, at any stage, without a mention or a Stage Participant window.
--
-- 1. sor_access_level gains one way in: on either list + the SOR has a Costing Matrix -> 'participant'
--    (the money-free record, PMS tab included). It makes nobody a Deal Team member or Stage Participant.
-- 2. costing_tier puts the Evaluation list at the participant tier, after every existing check, so a
--    caller with a higher tier (Super Admin, Final Acquire, Purchasing, Deal Team) keeps it.
-- An SOR with no Costing Matrix stays closed to both lists. Re-runnable.

-- Carried forward from 20261005131800_mention_window_fixes.sql with one new branch after 'full'.
create or replace function public.sor_access_level(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when not exists (select 1 from public.sales_opportunities where id = p_opportunity_id) then 'none'
    when public.is_super_admin() then 'full'
    when exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id
        and (
          public.sor_is_deal_team(o, public.get_employee_id())
          or public.sor_always_sees(o, public.get_employee_id())
        )
    ) then 'full'
    -- #545: the Final Acquire list or the Evaluation list, on an SOR that has a Costing Matrix.
    -- Independent of stage, mention and Stage Participants.
    when (public.costing_on_list('final_acquire') or public.costing_on_list('evaluation'))
      and exists (select 1 from public.costing_matrices m where m.opportunity_id = p_opportunity_id)
    then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    -- An open Mention Window, or the header grant on an SOR that still has no visit.
    when exists (
      select 1 from public.sor_mention_viewers m
      left join public.sor_stage_visits v on v.id = m.stage_visit_id
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
        and (
          (m.stage_visit_id is null
            and not exists (select 1 from public.sor_stage_visits sv where sv.opportunity_id = p_opportunity_id))
          -- v.id, not just v.left_at: a null grant left-joins to all-null v.
          or (v.id is not null and v.left_at is null and v.undone_at is null)
        )
    ) then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
    ) then 'locked'
    -- A Mention Window the SOR has since left, or a header grant it outgrew.
    when exists (
      select 1 from public.sor_mention_viewers m
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
    ) then 'locked'
    when exists (
      select 1 from public.purchase_request_members m
      join public.purchase_requests r on r.id = m.request_id
      where r.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
    ) then 'locked'
    else 'none'
  end
$function$;

-- Carried forward from 20261018100000_costing_matrix_tender_lines.sql with the Evaluation list added last.
create or replace function public.costing_tier(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.sales_opportunities o where o.id = p_opportunity_id) then null
    when coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire') then 'closed_book'
    when public.has_purchasing_access() then 'cost'
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
    -- #545: the Evaluation list reads the matrix with no money, whatever the stage.
    when public.costing_on_list('evaluation')
      and exists (select 1 from public.costing_matrices m where m.opportunity_id = p_opportunity_id)
    then 'participant'
    else null
  end
$$;
