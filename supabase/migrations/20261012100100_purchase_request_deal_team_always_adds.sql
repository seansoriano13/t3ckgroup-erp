-- #503: the Deal Team can always add Requested Items (#209: "the Deal Team
-- adds items"). The requesters setting (20261009110000) replaced the Deal Team
-- rule once a list was set, locking out Deal Team members not on it. It now
-- only widens: the Deal Team rule always applies, and anyone the list covers
-- may add on top. The Buyer and a Direct request's Requester are unchanged.
-- Redefines: purchase_request_can_add_items.

comment on column public.purchase_requests.requesters is
  'Who else may request items on a Project request, on top of the Deal Team: people selectors copied from the Open Purchase Request action. Null adds nobody.';

create or replace function public.purchase_request_can_add_items(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from purchase_requests r
    where r.id = p_request_id
      and get_employee_id() is not null
      and (
        r.buyer_id = get_employee_id()
        or (r.opportunity_id is null and r.created_by = get_employee_id())
        or exists (
          select 1 from purchase_request_members m
          where m.request_id = r.id
            and m.employee_id = get_employee_id()
            and (
              m.side in ('sales', 'requester')
              or exists (
                select 1 from sales_opportunities o, public._sor_deal_team_roles(o) t
                where o.id = r.opportunity_id and t.employee_id = m.employee_id
              )
              or public._purchase_request_may_request(r, m.employee_id)
            )
        )
      )
  );
$$;

revoke all on function public.purchase_request_can_add_items(uuid) from public, anon;
grant execute on function public.purchase_request_can_add_items(uuid) to authenticated;
