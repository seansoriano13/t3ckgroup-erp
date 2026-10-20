-- #549 (spec #544): a purchaser can correct the PO number on an Ordered item.
--
-- Adds the 'correct' action to purchase_request_item_apply_po_check (#548), the
-- server-only path the odoo-po-verify edge function calls with Odoo's answer.
-- 'correct' is allowed only while the item is Ordered (Received is fixed) and
-- only for Purchasing. The new PO gets the same three verdicts as the first
-- entry (found -> VERIFIED, not_found -> refused naming the PO, unreachable ->
-- PENDING_VERIFICATION). PO lines picked on the old PO are cleared, and the
-- request's history records the old and the new PO number.

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
  v_actor uuid;
  v_item public.purchase_request_items;
  v_old text;
begin
  if p_action is null or p_action not in ('order', 'correct') then
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

  if p_action = 'correct' then
    v_actor := public.get_employee_id();
    if v_actor is null then
      raise exception 'purchase_request_correct_po: not signed in' using errcode = '42501';
    end if;
    select * into v_item from public.purchase_request_items where id = p_item_id for update;
    if v_item.id is null then
      raise exception 'purchase_request_correct_po: item % not found', p_item_id using errcode = 'P0002';
    end if;
    if coalesce(public.purchase_request_actor_side(v_item.request_id), '') <> 'purchasing' then
      raise exception 'purchase_request_correct_po: only Purchasing corrects an item''s PO' using errcode = '42501';
    end if;
    if v_item.status <> 'ordered' then
      raise exception 'purchase_request_correct_po: % is %, not Ordered; a PO can only be corrected while the item is Ordered',
        v_item.name, public._purchase_request_item_status_label(v_item.status)
        using errcode = '22023';
    end if;
    if v_item.po_number is not distinct from v_po then
      raise exception 'purchase_request_correct_po: % is already on PO %', v_item.name, v_po using errcode = '22023';
    end if;
  end if;

  v_verification := case p_odoo
    when 'found' then 'VERIFIED'
    when 'unreachable' then 'PENDING_VERIFICATION'
    else null
  end;
  if v_verification is null then
    raise exception 'purchase_request_set_item_status: Odoo has no purchase order %; check the number and try again', v_po
      using errcode = '22023';
  end if;

  if p_action = 'order' then
    return public._purchase_request_set_item_status(
      p_item_id, 'ordered',
      jsonb_build_object('po_number', v_po, 'po_verification', v_verification),
      true);
  end if;

  -- 'correct': swap the PO, drop lines picked on the old one, and say so in the request.
  v_old := v_item.po_number;
  update public.purchase_request_items
     set po_number = v_po,
         po_verification = v_verification,
         odoo_po_line_ids = '{}'
   where id = v_item.id
  returning * into v_item;

  perform public._purchase_request_post_event(
    v_item.request_id,
    v_actor,
    format('%s: PO %s → %s.', v_item.name, coalesce(v_old, 'none'), v_po),
    jsonb_build_object(
      'event', 'item_po_corrected',
      'item_id', v_item.id,
      'from_po', v_old,
      'to_po', v_po,
      'po_verification', v_verification
    )
  );

  return v_item;
end;
$$;

comment on function public.purchase_request_item_apply_po_check(text, uuid, text, text, text) is
  '#548/#549: server-only (service role). Applies a PO action on a Requested Item as the given signed-in employee, with Odoo''s answer (found / not_found / unreachable) turned into the verdict: VERIFIED, refused naming the PO, or PENDING_VERIFICATION. Actions: order (set Ordered with a PO) and correct (Purchasing swaps the PO on an Ordered item; picked PO lines are cleared and the old and new PO are posted in the request). Called by the odoo-po-verify edge function.';

revoke all on function public.purchase_request_item_apply_po_check(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.purchase_request_item_apply_po_check(text, uuid, text, text, text) to service_role;
