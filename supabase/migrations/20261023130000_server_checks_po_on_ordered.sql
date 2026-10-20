-- #548 (spec #544): the server checks a PO number against Odoo when an item is
-- set to Ordered. Before, purchase_request_set_item_status stored whatever
-- `po_verification` the browser sent, so a made-up PO could be saved as
-- VERIFIED.
--
-- 1. The status move's body moves to _purchase_request_set_item_status(..., p_server).
--    purchase_request_set_item_status (signed-in callers) is a thin wrapper with
--    p_server = false, and now refuses `po_verification` in the details.
-- 2. purchase_request_item_apply_po_check is the server-only path (service role
--    only). The odoo-po-verify edge function asks Odoo, then calls it with what
--    Odoo said: 'found', 'not_found' or 'unreachable'. It acts as the signed-in
--    caller (identity here is the JWT email claim), so every membership/side rule
--    still applies, and decides the verdict:
--      found       -> VERIFIED
--      not_found   -> refused, naming the PO; nothing is saved
--      unreachable -> PENDING_VERIFICATION ("not checked")
--    p_action keeps it generic: only 'order' today; "Correct PO" (#549) adds an
--    action here rather than a new path.

create or replace function public._purchase_request_set_item_status(
  p_item_id uuid,
  p_status text,
  p_details jsonb,
  p_server boolean
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
  v_key text;
  v_po text;
  v_verification text;
begin
  if v_actor is null then
    raise exception 'purchase_request_set_item_status: not signed in' using errcode = '42501';
  end if;
  if p_status is null or p_status not in (
    'requested', 'from_stock', 'to_order', 'canvassing', 'ordered', 'received',
    'substituted', 'cannot_source', 'cancelled'
  ) then
    raise exception 'purchase_request_set_item_status: % is not an item status', coalesce(p_status, 'null') using errcode = '22023';
  end if;
  if jsonb_typeof(v_details) <> 'object' then
    raise exception 'purchase_request_set_item_status: details must be an object' using errcode = '22023';
  end if;
  -- #548: the Odoo check is the server's word, never the browser's.
  if v_details ? 'po_verification' and not p_server then
    raise exception 'purchase_request_set_item_status: only the server may record a PO check; send the PO number and it is checked against Odoo for you'
      using errcode = '42501';
  end if;

  -- Only Ordered takes details: its PO number and what Odoo said about it.
  if p_status <> 'ordered' and v_details <> '{}'::jsonb then
    raise exception 'purchase_request_set_item_status: % takes no details', public._purchase_request_item_status_label(p_status)
      using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(v_details) loop
    if v_key not in ('po_number', 'po_verification') then
      raise exception 'purchase_request_set_item_status: Ordered takes a PO number and its check, not %', v_key
        using errcode = '22023';
    end if;
  end loop;

  if v_details ? 'po_number' and jsonb_typeof(v_details->'po_number') not in ('string', 'null') then
    raise exception 'purchase_request_set_item_status: the PO number must be text' using errcode = '22023';
  end if;
  v_po := nullif(upper(btrim(v_details->>'po_number')), '');
  v_verification := nullif(btrim(v_details->>'po_verification'), '');
  if v_po is not null and v_po !~ '^P[0-9]+$' then
    raise exception 'purchase_request_set_item_status: % isn''t an Odoo PO number ("P" then digits, e.g. P01234)', v_po
      using errcode = '22023';
  end if;
  if v_verification is not null and v_po is null then
    raise exception 'purchase_request_set_item_status: a PO check needs a PO number' using errcode = '22023';
  end if;
  if v_verification is not null
     and v_verification not in ('UNVERIFIED', 'VERIFIED', 'PENDING_VERIFICATION', 'NOT_FOUND') then
    raise exception 'purchase_request_set_item_status: % is not a PO check result', v_verification using errcode = '22023';
  end if;
  if v_po is not null then
    v_verification := coalesce(v_verification, 'UNVERIFIED');
    v_details := jsonb_build_object('po_number', v_po, 'po_verification', v_verification);
  else
    v_details := '{}'::jsonb;
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_set_item_status: item % not found', p_item_id using errcode = 'P0002';
  end if;

  v_side := public.purchase_request_actor_side(v_item.request_id);
  if v_side is null then
    raise exception 'purchase_request_set_item_status: only the request''s members may change an item' using errcode = '42501';
  end if;

  v_item := public._purchase_request_item_move(v_item, p_status, v_side, v_actor, v_details, 'purchase_request_set_item_status');

  if v_po is not null then
    update public.purchase_request_items
       set po_number = v_po,
           po_verification = v_verification
     where id = v_item.id
    returning * into v_item;
  end if;

  return v_item;
end;
$$;

create or replace function public.purchase_request_set_item_status(
  p_item_id uuid,
  p_status text,
  p_details jsonb default '{}'::jsonb
) returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._purchase_request_set_item_status(p_item_id, p_status, p_details, false);
end;
$$;

comment on function public.purchase_request_set_item_status(uuid, text, jsonb) is
  '#306/#312/#548: moves a Requested Item along its status path. Checks the transition and the caller''s side (purchasing walks the path; the sales side may only cancel), records who and when, and posts the change in the request. Ordered alone takes details: an optional `po_number` (P + digits). A PO check (`po_verification`) is refused from a signed-in caller; only purchase_request_item_apply_po_check (server) records one.';

revoke all on function public._purchase_request_set_item_status(uuid, text, jsonb, boolean) from public, anon, authenticated;

create or replace function public.purchase_request_item_apply_po_check(
  p_actor_email text,
  p_item_id uuid,
  p_action text,
  p_po_number text,
  p_odoo text
) returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po text := nullif(upper(btrim(p_po_number)), '');
  v_verification text;
begin
  if p_action is null or p_action not in ('order') then
    raise exception 'purchase_request_item_apply_po_check: % is not a PO action', coalesce(p_action, 'null') using errcode = '22023';
  end if;
  if p_odoo is null or p_odoo not in ('found', 'not_found', 'unreachable') then
    raise exception 'purchase_request_item_apply_po_check: % is not an Odoo answer', coalesce(p_odoo, 'null') using errcode = '22023';
  end if;
  if v_po is null or v_po !~ '^P[0-9]+$' then
    raise exception 'purchase_request_set_item_status: % isn''t an Odoo PO number ("P" then digits, e.g. P01234)', coalesce(p_po_number, '') using errcode = '22023';
  end if;
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'purchase_request_set_item_status: not signed in' using errcode = '42501';
  end if;

  -- Act as the caller the edge function authenticated: identity is the JWT email claim.
  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);

  v_verification := case p_odoo
    when 'found' then 'VERIFIED'
    when 'unreachable' then 'PENDING_VERIFICATION'
    else null
  end;
  if v_verification is null then
    raise exception 'purchase_request_set_item_status: Odoo has no purchase order %; check the number and try again', v_po
      using errcode = '22023';
  end if;

  -- 'order' is the only action so far (#549 adds Correct PO beside it).
  return public._purchase_request_set_item_status(
    p_item_id, 'ordered',
    jsonb_build_object('po_number', v_po, 'po_verification', v_verification),
    true);
end;
$$;

comment on function public.purchase_request_item_apply_po_check(text, uuid, text, text, text) is
  '#548: server-only (service role). Applies a PO action on a Requested Item as the given signed-in employee, with Odoo''s answer (found / not_found / unreachable) turned into the verdict: VERIFIED, refused naming the PO, or PENDING_VERIFICATION. Called by the odoo-po-verify edge function.';

revoke all on function public.purchase_request_item_apply_po_check(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.purchase_request_item_apply_po_check(text, uuid, text, text, text) to service_role;
