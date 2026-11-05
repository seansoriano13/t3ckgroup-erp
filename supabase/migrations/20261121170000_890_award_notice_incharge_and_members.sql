-- Issue #890 (spec #907, decision 6) — who the "SOR Awarded" notice goes to.
--
-- Recipients, once the SOR has a Buyer:
--   * the Buyer of the SOR's Purchase Request (purchase_requests.buyer_id);
--   * the SOR's Purchasing Incharge (costing_matrices.purchasing_incharge_id, #883);
--   * the Purchasing members of the request (purchase_request_members, side 'purchasing').
-- If no Purchase Request on the SOR has a Buyer yet, the notice goes to the
-- Purchasing heads (is_head AND has_purchasing_flow) instead.
-- Soft-deleted employees never count. No broadcast.
--
-- Replaces the 20261105120000 body, which read the retired sor_procurement_requests
-- table and so named no Buyer in the current model. The signature is unchanged.

create or replace function public.sor_award_notice_recipients(p_opportunity_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_buyers uuid[];
  v_people uuid[];
  v_heads uuid[];
begin
  if public.get_employee_id() is null then
    raise exception 'sor_award_notice_recipients: not signed in' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct r.buyer_id), '{}'::uuid[])
    into v_buyers
  from public.purchase_requests r
  join public.employees e on e.id = r.buyer_id
  where r.opportunity_id = p_opportunity_id
    and e.is_deleted is not true;

  if cardinality(v_buyers) = 0 then
    select coalesce(array_agg(e.id), '{}'::uuid[])
      into v_heads
    from public.employees e
    where e.is_head
      and e.has_purchasing_flow
      and e.is_deleted is not true;
    return v_heads;
  end if;

  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
    into v_people
  from (
    select unnest(v_buyers) as id
    union
    select m.purchasing_incharge_id
    from public.costing_matrices m
    where m.opportunity_id = p_opportunity_id
      and m.purchasing_incharge_id is not null
    union
    select pm.employee_id
    from public.purchase_request_members pm
    join public.purchase_requests r on r.id = pm.request_id
    where r.opportunity_id = p_opportunity_id
      and pm.side = 'purchasing'
  ) p
  join public.employees e on e.id = p.id
  where e.is_deleted is not true;

  return v_people;
end;
$$;

comment on function public.sor_award_notice_recipients(uuid) is
  '#890: the employee ids the SOR Awarded notice goes to: the SOR''s Purchase Request Buyers, its Purchasing Incharge and its request''s purchasing members; the Purchasing heads when no request has a Buyer yet.';

grant execute on function public.sor_award_notice_recipients(uuid) to authenticated;
