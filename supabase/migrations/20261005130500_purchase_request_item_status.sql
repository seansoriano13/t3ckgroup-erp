-- ==============================================================================
-- 20261005130500_purchase_request_item_status.sql
--
-- Issue #306 (part of #209) — the Requested Item status path.
--
-- THE PATH (mirrors allowedTransitions in src/constants/purchaseRequest.js)
--   Requested → From stock (closed), or To order → Canvassing → Ordered →
--   Received (closed). To order may skip Canvassing (#316). Ways out, from any
--   open status, all closed: Substituted, Cannot source, Cancelled. A closed
--   status goes nowhere.
--
-- WHO (the actor's side, `pr_actor_side`)
--   purchasing  a Super Admin, or a member who holds Purchasing access now
--               (the same rule as purchase_request_can_manage_members):
--               walks the path and takes any way out.
--   sales       a sales-side member, or the Buyer without Purchasing access:
--               may only cancel (#209 Access: "adding items and cancelling:
--               members on the sales side, or the Buyer").
--   other       any other member: changes nothing.
--   null        not a member: changes nothing.
--
-- ONE RPC FOR EVERY CHANGE
--   `pr_set_item_status(item, status, details)` checks the transition and the
--   side, records who and when on the item, and posts an `item_status_changed`
--   event in the request. `details` is a jsonb object kept for later steps
--   (#312 adds the PO number and PO lines on Ordered); no key is accepted yet,
--   so nothing unchecked can ride along.
--
-- SUBSTITUTES
--   `pr_add_substitute` lets the Buyer (or a Super Admin) add a new-product
--   item linked to the one it replaces via `substitute_for_item_id`; the
--   original moves to Substituted through the same status path, so the same
--   rules and the same event apply. The new item starts at Requested and
--   posts an `item_added` event naming what it replaces.
--
-- Notifications on status changes are #307's; nothing here notifies.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: new
-- functions only, nothing existing altered or replaced. Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- The rules
-- ------------------------------------------------------------------------------

create or replace function public._purchase_request_item_status_label(p_status text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_status
    when 'requested'     then 'Requested'
    when 'from_stock'    then 'From stock'
    when 'to_order'      then 'To order'
    when 'canvassing'    then 'Canvassing'
    when 'ordered'       then 'Ordered'
    when 'received'      then 'Received'
    when 'substituted'   then 'Substituted'
    when 'cannot_source' then 'Cannot source'
    when 'cancelled'     then 'Cancelled'
    else p_status
  end;
$$;

-- Whether an item status is closed: nothing more happens to the item. The one
-- place the list lives.
create or replace function public._purchase_request_item_is_closed(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status in ('from_stock', 'received', 'substituted', 'cannot_source', 'cancelled');
$$;

-- Whether a member on `p_side` may move an item from `p_from` to `p_to`.
create or replace function public._purchase_request_item_transition_ok(p_from text, p_to text, p_side text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when public._purchase_request_item_is_closed(p_from) then false
    when p_side = 'sales' then p_to = 'cancelled'
    when p_side = 'purchasing' then
      p_to in ('substituted', 'cannot_source', 'cancelled')
      or (p_from = 'requested'  and p_to in ('from_stock', 'to_order'))
      or (p_from = 'to_order'   and p_to in ('canvassing', 'ordered'))
      or (p_from = 'canvassing' and p_to = 'ordered')
      or (p_from = 'ordered'    and p_to = 'received')
    else false
  end;
$$;

-- The caller's side on a request, for status changes. Null when the caller
-- isn't a member (and isn't a Super Admin).
create or replace function public.pr_actor_side(p_request_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when get_employee_id() is null or r.id is null then null
    when coalesce(is_super_admin(), false) then 'purchasing'
    when m.employee_id is not null and has_purchasing_access() then 'purchasing'
    when m.side = 'sales' or r.buyer_id = get_employee_id() then 'sales'
    when m.employee_id is not null then 'other'
    else null
  end
  from (select 1) one
  left join purchase_requests r on r.id = p_request_id
  left join purchase_request_members m
    on m.request_id = r.id and m.employee_id = get_employee_id();
$$;

comment on function public.pr_actor_side(uuid) is
  '#306: the caller''s side for Requested Item status changes — purchasing (Super Admin, or a member with Purchasing access), sales (a sales-side member, or the Buyer: may only cancel), other, or null for a non-member.';

-- Whether the caller may add a substitute: the Buyer (or a Super Admin),
-- acting on the purchasing side.
create or replace function public.pr_can_add_substitute(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.pr_actor_side(p_request_id) = 'purchasing', false)
     and (
       coalesce(is_super_admin(), false)
       or exists (select 1 from purchase_requests r where r.id = p_request_id and r.buyer_id = get_employee_id())
     );
$$;

comment on function public.pr_can_add_substitute(uuid) is
  '#306: whether the caller may add a substitute item — the request''s Buyer, or a Super Admin, with Purchasing access.';

-- ------------------------------------------------------------------------------
-- Internals
-- ------------------------------------------------------------------------------

-- Posts an event message in a request, authored by `p_author`, and touches it.
create or replace function public._purchase_request_post_event(
  p_request_id uuid,
  p_author uuid,
  p_content text,
  p_metadata jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (p_request_id, p_author, p_content, p_metadata);

  update public.purchase_requests set updated_at = now() where id = p_request_id;
end;
$$;

revoke all on function public._purchase_request_post_event(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- Moves a locked item to `p_to` after checking the transition for `p_side`;
-- records who and when, and posts the change. Returns the updated item.
create or replace function public._purchase_request_item_move(
  p_item public.purchase_request_items,
  p_to text,
  p_side text,
  p_actor uuid,
  p_details jsonb,
  p_fn text
) returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.purchase_request_items;
begin
  if p_item.status = p_to then
    raise exception '%: the item is already %', p_fn, public._purchase_request_item_status_label(p_to)
      using errcode = '22023';
  end if;
  if not public._purchase_request_item_transition_ok(p_item.status, p_to, p_side) then
    raise exception '%: % can''t move from % to %', p_fn,
      case p_side
        when 'purchasing' then 'Purchasing'
        when 'sales' then 'the sales side'
        else 'you'
      end,
      public._purchase_request_item_status_label(p_item.status),
      public._purchase_request_item_status_label(p_to)
      using errcode = '42501';
  end if;

  update public.purchase_request_items
     set status = p_to,
         status_changed_by = p_actor,
         status_changed_at = now()
   where id = p_item.id
  returning * into v_item;

  perform public._purchase_request_post_event(
    v_item.request_id,
    p_actor,
    format('%s: %s → %s.', v_item.name,
      public._purchase_request_item_status_label(p_item.status),
      public._purchase_request_item_status_label(p_to)),
    jsonb_build_object(
      'event', 'item_status_changed',
      'item_id', v_item.id,
      'from', p_item.status,
      'to', p_to,
      'changed_by', p_actor,
      'changed_at', v_item.status_changed_at
    ) || case when p_details = '{}'::jsonb then '{}'::jsonb else jsonb_build_object('details', p_details) end
  );

  return v_item;
end;
$$;

revoke all on function public._purchase_request_item_move(public.purchase_request_items, text, text, uuid, jsonb, text)
  from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Changing status
-- ------------------------------------------------------------------------------

create or replace function public.pr_set_item_status(
  p_item_id uuid,
  p_status text,
  p_details jsonb default '{}'::jsonb
) returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_item public.purchase_request_items;
  v_side text;
begin
  if v_actor is null then
    raise exception 'pr_set_item_status: not signed in' using errcode = '42501';
  end if;
  if p_status is null or p_status not in (
    'requested', 'from_stock', 'to_order', 'canvassing', 'ordered', 'received',
    'substituted', 'cannot_source', 'cancelled'
  ) then
    raise exception 'pr_set_item_status: % is not an item status', coalesce(p_status, 'null') using errcode = '22023';
  end if;
  if jsonb_typeof(v_details) <> 'object' then
    raise exception 'pr_set_item_status: details must be an object' using errcode = '22023';
  end if;
  -- No status takes details yet; #312 adds the PO number and lines on Ordered.
  if v_details <> '{}'::jsonb then
    raise exception 'pr_set_item_status: % takes no details', public._purchase_request_item_status_label(p_status)
      using errcode = '22023';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'pr_set_item_status: item % not found', p_item_id using errcode = 'P0002';
  end if;

  v_side := public.pr_actor_side(v_item.request_id);
  if v_side is null then
    raise exception 'pr_set_item_status: only the request''s members may change an item' using errcode = '42501';
  end if;

  return public._purchase_request_item_move(v_item, p_status, v_side, v_actor, v_details, 'pr_set_item_status');
end;
$$;

comment on function public.pr_set_item_status(uuid, text, jsonb) is
  '#306: moves a Requested Item along its status path. Checks the transition and the caller''s side (purchasing walks the path; the sales side may only cancel), records who and when, and posts the change in the request. `p_details` is reserved for per-status data (#312: PO number and lines on Ordered); none is accepted yet.';

-- ------------------------------------------------------------------------------
-- Substitutes
-- ------------------------------------------------------------------------------

create or replace function public.pr_add_substitute(
  p_item_id uuid,
  p_name text,
  p_quantity numeric,
  p_unit text default null,
  p_description text default null,
  p_images jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_images jsonb := coalesce(p_images, '[]'::jsonb);
  v_original public.purchase_request_items;
  v_req public.purchase_requests;
  v_side text;
  v_item public.purchase_request_items;
  v_amount text;
begin
  if v_actor is null then
    raise exception 'pr_add_substitute: not signed in' using errcode = '42501';
  end if;

  select * into v_original from public.purchase_request_items where id = p_item_id for update;
  if v_original.id is null then
    raise exception 'pr_add_substitute: item % not found', p_item_id using errcode = 'P0002';
  end if;
  select * into v_req from public.purchase_requests where id = v_original.request_id;

  v_side := public.pr_actor_side(v_req.id);
  if not public.pr_can_add_substitute(v_req.id) then
    raise exception 'pr_add_substitute: only the request''s Buyer may add a substitute' using errcode = '42501';
  end if;
  if not public._purchase_request_item_transition_ok(v_original.status, 'substituted', v_side) then
    raise exception 'pr_add_substitute: % is already closed', v_original.name using errcode = '22023';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception 'pr_add_substitute: a substitute needs a name' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'pr_add_substitute: the quantity must be more than zero' using errcode = '22023';
  end if;
  if jsonb_typeof(v_images) <> 'array'
     or jsonb_array_length(v_images) > 5
     or exists (
       select 1 from jsonb_array_elements(v_images) img
       where jsonb_typeof(img) <> 'object' or nullif(img->>'url', '') is null
     ) then
    raise exception 'pr_add_substitute: images must be up to 5 uploaded files' using errcode = '22023';
  end if;

  insert into public.purchase_request_items
    (request_id, source, name, unit, quantity, description, images, substitute_for_item_id, requested_by)
  values
    (v_req.id, 'new', btrim(p_name), nullif(btrim(p_unit), ''), p_quantity,
     nullif(btrim(p_description), ''), v_images, v_original.id, v_actor)
  returning * into v_item;

  v_amount := trim_scale(v_item.quantity)::text || coalesce(' ' || v_item.unit, '');
  perform public._purchase_request_post_event(
    v_req.id,
    v_actor,
    format('Offered %s × %s as a substitute for %s.', v_item.name, v_amount, v_original.name),
    jsonb_build_object('event', 'item_added', 'item_id', v_item.id, 'source', v_item.source,
                       'substitute_for_item_id', v_original.id)
  );

  perform public._purchase_request_item_move(
    v_original, 'substituted', v_side, v_actor,
    jsonb_build_object('substitute_item_id', v_item.id), 'pr_add_substitute'
  );

  return v_item.id;
end;
$$;

comment on function public.pr_add_substitute(uuid, text, numeric, text, text, jsonb) is
  '#306: the Buyer adds a new-product Requested Item that replaces another (linked by substitute_for_item_id); the original moves to Substituted. Both post in the request.';

-- ------------------------------------------------------------------------------
-- Grants: signed-in callers only
-- ------------------------------------------------------------------------------

revoke all on function public._purchase_request_item_status_label(text) from public, anon;
revoke all on function public._purchase_request_item_is_closed(text) from public, anon;
revoke all on function public._purchase_request_item_transition_ok(text, text, text) from public, anon;
revoke all on function public.pr_actor_side(uuid) from public, anon;
revoke all on function public.pr_can_add_substitute(uuid) from public, anon;
revoke all on function public.pr_set_item_status(uuid, text, jsonb) from public, anon;
revoke all on function public.pr_add_substitute(uuid, text, numeric, text, text, jsonb) from public, anon;

grant execute on function public._purchase_request_item_status_label(text) to authenticated;
grant execute on function public._purchase_request_item_is_closed(text) to authenticated;
grant execute on function public._purchase_request_item_transition_ok(text, text, text) to authenticated;
grant execute on function public.pr_actor_side(uuid) to authenticated;
grant execute on function public.pr_can_add_substitute(uuid) to authenticated;
grant execute on function public.pr_set_item_status(uuid, text, jsonb) to authenticated;
grant execute on function public.pr_add_substitute(uuid, text, numeric, text, text, jsonb) to authenticated;
