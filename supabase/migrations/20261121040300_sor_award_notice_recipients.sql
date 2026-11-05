-- #890: who gets the "SOR Awarded" notice.
--
-- The notice used to go to every employee with has_purchasing_flow. Now it
-- goes to the people buying for the SOR:
--   * the Buyer of each Purchase Request on the SOR (sor_procurement_requests.assigned_to);
--   * if no request on the SOR has a Buyer yet, the Purchasing heads
--     (is_head AND has_purchasing_flow) instead.
-- Soft-deleted employees never count. No broadcast.
--
-- The SOR's Purchasing Incharge and the request's purchasing members are not
-- modelled in the schema yet, so they are not included here.
--
-- Security definer: a Sales user who saves a Date of Award cannot read every
-- Purchase Request row under RLS, but the notice must still reach its Buyer.
-- The function only returns employee ids, and only to a signed-in employee.

create or replace function public.sor_award_notice_recipients(p_opportunity_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_buyers uuid[];
  v_heads uuid[];
begin
  if public.get_employee_id() is null then
    raise exception 'sor_award_notice_recipients: not signed in' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct e.id), '{}'::uuid[])
    into v_buyers
  from public.sor_procurement_requests r
  join public.employees e on e.id = r.assigned_to
  where r.opportunity_id = p_opportunity_id
    and e.is_deleted is not true;

  if cardinality(v_buyers) > 0 then
    return v_buyers;
  end if;

  select coalesce(array_agg(e.id), '{}'::uuid[])
    into v_heads
  from public.employees e
  where e.is_head
    and e.has_purchasing_flow
    and e.is_deleted is not true;

  return v_heads;
end;
$$;

comment on function public.sor_award_notice_recipients(uuid) is
  '#890: the employee ids the SOR Awarded notice goes to: the Buyers of the SOR''s Purchase Requests, or, when none has a Buyer, the Purchasing heads.';

grant execute on function public.sor_award_notice_recipients(uuid) to authenticated;
