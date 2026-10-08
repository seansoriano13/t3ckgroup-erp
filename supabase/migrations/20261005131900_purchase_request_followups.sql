-- ==============================================================================
-- 20261005131900_purchase_request_followups.sql
--
-- Two gaps left open when #209 shipped:
--
-- 1. THE BUYER ISN'T TOLD WHEN THE SOR GOES AWAY
--    When an SOR is deleted, or moves to a Terminal Stage other than its flow's
--    Won Stage (lost), the request's Buyer gets one notification
--    (`PURCHASE_REQUEST_SOR_CLOSED`) if the request still has open items.
--    Nothing else changes: the request and its history stay.
--
-- 2. LATER PURCHASING HOLDERS ARE ADDED TO LIVE REQUESTS
--    When someone is granted Purchasing access, they join every request that
--    still has an open item, the same way the opening action adds everyone who
--    held it at that time (the SOR window follows `_purchase_request_add_member`).
--    Closed requests are left alone. No chat event is posted.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: two new
-- functions and two triggers. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SOR deleted or lost -> tell the Buyer
-- ------------------------------------------------------------------------------

create or replace function public._purchase_request_sor_closed_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests;
  v_why text;
begin
  if new.is_deleted and not old.is_deleted then
    v_why := 'was deleted';
  elsif new.flow_stage_id is distinct from old.flow_stage_id
        and exists (
          select 1
          from public.flow_stages s
          join public.sales_flows f on f.id = s.flow_id
          where s.id = new.flow_stage_id
            and s.is_terminal
            and s.id is distinct from f.won_stage_id
        ) then
    v_why := 'was lost';
  else
    return null;
  end if;

  select * into v_req from public.purchase_requests where opportunity_id = new.id;
  if v_req.id is null or v_req.buyer_id is null then
    return null;
  end if;

  if not exists (
    select 1 from public.purchase_request_items i
    where i.request_id = v_req.id
      and i.status not in ('from_stock', 'received', 'substituted', 'cannot_source', 'cancelled')
  ) then
    return null;
  end if;

  perform public._purchase_request_notify(
    v_req.id,
    array[v_req.buyer_id],
    public.get_employee_id(),
    'PURCHASE_REQUEST_SOR_CLOSED',
    'SOR ' || v_why,
    format('%s %s. Its Purchase Request still has open items.', public._purchase_request_label(v_req.id), v_why),
    false
  );
  return null;
end;
$$;

revoke all on function public._purchase_request_sor_closed_notify() from public, anon, authenticated;

drop trigger if exists purchase_request_sor_closed_notify on public.sales_opportunities;
create trigger purchase_request_sor_closed_notify
  after update of is_deleted, flow_stage_id on public.sales_opportunities
  for each row execute function public._purchase_request_sor_closed_notify();

-- ------------------------------------------------------------------------------
-- 2. New Purchasing holder -> member of every live request
-- ------------------------------------------------------------------------------

create or replace function public._purchase_request_new_purchaser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req uuid;
begin
  if not coalesce(new.has_purchasing_flow, false)
     or coalesce(new.is_deleted, false)
     or (tg_op = 'UPDATE'
         and coalesce(old.has_purchasing_flow, false)
         and not coalesce(old.is_deleted, false)) then
    return null;
  end if;

  for v_req in
    select r.id from public.purchase_requests r
    where exists (
      select 1 from public.purchase_request_items i
      where i.request_id = r.id
        and i.status not in ('from_stock', 'received', 'substituted', 'cannot_source', 'cancelled')
    )
  loop
    perform public._purchase_request_add_member(v_req, new.id, public.get_employee_id());
  end loop;
  return null;
end;
$$;

revoke all on function public._purchase_request_new_purchaser() from public, anon, authenticated;

drop trigger if exists purchase_request_new_purchaser on public.employees;
create trigger purchase_request_new_purchaser
  after insert or update of has_purchasing_flow, is_deleted on public.employees
  for each row execute function public._purchase_request_new_purchaser();
