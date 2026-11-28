-- Everyone in a Purchase Request may ask for products (2026-11-28).
--
-- Until now only the sales side, the Deal Team, the Buyer, a Direct request's opener and the people
-- on the Stage Action's "Who can request items" list could add. A purchasing member who wasn't the
-- Buyer, or an extra member, was refused. Now every member of the request may add: the same people
-- who may post in its Chat, a Super Admin included.
--
-- Who added what stays on record without anything new: every added product gets its own Chat line
-- (event item_added), written as the person who added it, with the time. Nobody can write or edit
-- those lines from the app (purchase_request_messages_insert refuses a row with an event, and there
-- is no update or delete policy), and the item keeps requested_by.
--
-- The Stage Action's requesters list still adds people to the request on the requester side, who
-- may also cancel items; it no longer decides who may add.
--
-- Only replaces two functions, so it is safe to run twice.

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
        or is_purchase_request_member(r.id)
        or coalesce(is_super_admin(), false)
      )
  );
$$;
revoke all on function public.purchase_request_can_add_items(uuid) from public, anon;
grant execute on function public.purchase_request_can_add_items(uuid) to authenticated;

-- Same checks as before; only the refusal's wording follows the new rule.
create or replace function public._purchase_request_for_adding(p_request_id uuid, p_fn text)
returns public.purchase_requests
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests;
begin
  if public.get_employee_id() is null then
    raise exception '%: not signed in', p_fn using errcode = '42501';
  end if;
  select * into v_req from public.purchase_requests where id = p_request_id;
  if v_req.id is null then
    raise exception '%: request % not found', p_fn, p_request_id using errcode = 'P0002';
  end if;
  if not public.purchase_request_can_add_items(p_request_id) then
    raise exception '%: only the request''s members may ask for products', p_fn using errcode = '42501';
  end if;
  return v_req;
end;
$$;
revoke all on function public._purchase_request_for_adding(uuid, text) from public, anon, authenticated;
