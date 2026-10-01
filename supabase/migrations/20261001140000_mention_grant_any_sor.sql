-- A mention is an invitation on ANY SOR, not just old ones.
--
-- 20261001120000 limited the grant to SORs with no Stage Visit. A mention on a
-- Stage-scoped SOR now grants the same read-only 'participant' access: the
-- money-free record from sor_participant_record. It still opens no Stage Visit
-- data (tasks, logs, fields): those are gated by sor_visible_visit_ids, which a
-- mention does not touch, so Restricted Stages stay shut.

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
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    when exists (
      select 1 from public.sor_mention_viewers m
      where m.opportunity_id = p_opportunity_id
        and m.employee_id = public.get_employee_id()
    ) then 'participant'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
    ) then 'locked'
    else 'none'
  end
$function$;

create or replace function public.sor_grant_mention_view(p_opportunity_id uuid, p_employee_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_count integer;
begin
  -- Whoever can post a note on the SOR can mention someone into it.
  if public.sor_access_level(p_opportunity_id) not in ('full', 'participant') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.sor_mention_viewers (opportunity_id, employee_id, granted_by)
  select p_opportunity_id, e.id, public.get_employee_id()
  from public.employees e
  join public.sales_opportunities o on o.id = p_opportunity_id
  where e.id = any (p_employee_ids)
    and coalesce(e.is_deleted, false) = false
    -- Already reaches the SOR some other way: no grant row to clutter My SORs.
    and not coalesce(e.is_super_admin, false)
    -- sor_is_deal_team is NULL, not false, when some Deal Team columns are empty.
    and not coalesce(public.sor_is_deal_team(o, e.id), false)
    and not coalesce(public.sor_always_sees(o, e.id), false)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;
