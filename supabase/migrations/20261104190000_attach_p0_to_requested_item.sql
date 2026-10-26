-- 20261104190000_attach_p0_to_requested_item.sql
-- #684 (spec #675): Purchasing attaches the P0 they made in Odoo, and the line
-- follows it. Nobody picks Purchased (or Received) by hand any more.
--
-- 1. Hand moves: Purchasing may no longer move a line to Purchased or Received.
--    What is left by hand: Available, To purchase, Cannot source, Cancelled
--    (plus Still canvassing, which a Canvass sets). The sales side still only cancels.
-- 2. purchase_request_item_attach_po (service role only): called by the odoo-po-verify
--    edge function with what Odoo said about the P0. It sets the line from the P0:
--      RFQ              -> To purchase (the P0 number is the "RFQ P0..." note)
--      confirmed P0     -> Purchased
--      fully received   -> Received
--    The line also keeps what the P0 bought (`bought_as`) and the quantities.
-- 3. purchase_request_item_apply_po_check keeps only 'correct': the old 'order'
--    action (move to Purchased with a typed number) is replaced by the attach.
--
-- Additive columns; idempotent.

alter table public.purchase_request_items
  add column if not exists po_state text,
  add column if not exists po_ordered numeric,
  add column if not exists po_received numeric,
  add column if not exists bought_as text;

alter table public.purchase_request_items drop constraint if exists purchase_request_items_po_state_chk;
alter table public.purchase_request_items add constraint purchase_request_items_po_state_chk
  check (po_state is null or po_state in ('rfq', 'confirmed'));

comment on column public.purchase_request_items.po_state is
  '#684: whether the attached P0 is still an RFQ or confirmed in Odoo. Set when a P0 is attached.';
comment on column public.purchase_request_items.po_ordered is
  '#684: quantity on the attached P0 line, as Odoo had it when the P0 was attached.';
comment on column public.purchase_request_items.po_received is
  '#684: quantity received on the attached P0 line, as Odoo had it when the P0 was attached.';
comment on column public.purchase_request_items.bought_as is
  '#684: the Odoo product on the attached P0 line ("Bought as"). The item''s name stays what was asked ("Asked as").';

-- 1. Hand moves ----------------------------------------------------------------
create or replace function public._purchase_request_item_transition_ok(p_from text, p_to text, p_side text)
returns boolean
language sql
immutable
as $$
  select case
    when public._purchase_request_item_is_closed(p_from) then false
    when p_side = 'purchasing' then
      p_to in ('cannot_source', 'cancelled')
      or (p_from = 'not_checked' and p_to in ('available', 'to_purchase'))
      or (p_from = 'to_purchase' and p_to = 'still_canvassing')
    when p_side in ('sales', 'requester') then p_to = 'cancelled'
    else false
  end;
$$;

-- 2. Attach P0 -----------------------------------------------------------------
create or replace function public.purchase_request_item_attach_po(
  p_actor_email text,
  p_item_id uuid,
  p_po_number text,
  p_facts jsonb
) returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po text := nullif(upper(btrim(p_po_number)), '');
  v_actor uuid;
  v_item public.purchase_request_items;
  v_state text := p_facts->>'state';
  v_ordered numeric;
  v_received numeric;
  v_bought text := nullif(btrim(p_facts->>'bought_as'), '');
  v_to text;
  v_text text;
begin
  if v_po is null or v_po !~ '^P[0-9]+$' then
    raise exception 'purchase_request_item_attach_po: % isn''t an Odoo P0 number ("P" then digits, e.g. P01234)', coalesce(p_po_number, '') using errcode = '22023';
  end if;
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'purchase_request_item_attach_po: not signed in' using errcode = '42501';
  end if;
  if p_facts is null or jsonb_typeof(p_facts) <> 'object' or v_state is null or v_state not in ('rfq', 'confirmed') then
    raise exception 'purchase_request_item_attach_po: the P0 facts must say rfq or confirmed' using errcode = '22023';
  end if;
  v_ordered := coalesce((p_facts->>'ordered')::numeric, 0);
  v_received := coalesce((p_facts->>'received')::numeric, 0);

  -- Act as the caller the edge function authenticated: identity is the JWT email claim.
  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);

  v_actor := public.get_employee_id();
  if v_actor is null then
    raise exception 'purchase_request_item_attach_po: not signed in' using errcode = '42501';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'purchase_request_item_attach_po: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if coalesce(public.purchase_request_actor_side(v_item.request_id), '') <> 'purchasing' then
    raise exception 'purchase_request_item_attach_po: only Purchasing attaches a P0' using errcode = '42501';
  end if;
  if v_item.status in ('cancelled', 'received') then
    raise exception 'purchase_request_item_attach_po: nothing to attach to this line; % is %',
      v_item.name, public._purchase_request_item_status_label(v_item.status)
      using errcode = '22023';
  end if;

  v_to := case
    when v_state = 'rfq' then 'to_purchase'
    when v_ordered > 0 and v_received >= v_ordered then 'received'
    else 'purchased'
  end;

  update public.purchase_request_items
     set status = v_to,
         status_changed_by = case when status is distinct from v_to then v_actor else status_changed_by end,
         status_changed_at = case when status is distinct from v_to then now() else status_changed_at end,
         po_number = v_po,
         po_verification = 'VERIFIED',
         po_state = v_state,
         po_ordered = v_ordered,
         po_received = v_received,
         bought_as = v_bought,
         -- Lines picked on another P0 do not carry over.
         odoo_po_line_ids = case when po_number is distinct from v_po then '{}' else odoo_po_line_ids end
   where id = v_item.id
  returning * into v_item;

  v_text := case v_to
    when 'to_purchase' then format('%s: RFQ %s attached; still To purchase.', v_item.name, v_po)
    else format('%s: P0 %s attached; %s.', v_item.name, v_po, public._purchase_request_item_status_label(v_to))
  end;
  perform public._purchase_request_post_event(
    v_item.request_id,
    v_actor,
    v_text,
    jsonb_build_object(
      'event', 'item_po_attached',
      'item_id', v_item.id,
      'to', v_to,
      'po_number', v_po,
      'po_state', v_state,
      'bought_as', v_bought
    )
  );

  return v_item;
end;
$$;

comment on function public.purchase_request_item_attach_po(text, uuid, text, jsonb) is
  '#684: server-only (service role). Attaches an Odoo P0 to a Requested Item as the given signed-in Purchasing member, from the facts the odoo-po-verify edge function read in Odoo: state rfq (line stays To purchase) or confirmed (Purchased, or Received once everything arrived). Refused on Cancelled and Received lines.';

revoke all on function public.purchase_request_item_attach_po(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.purchase_request_item_attach_po(text, uuid, text, jsonb) to service_role;

-- 3. The PO check keeps only 'correct' -----------------------------------------
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
  if p_action is null or p_action not in ('correct') then
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

  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);

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
  if v_item.status <> 'purchased' then
    raise exception 'purchase_request_correct_po: % is %, not Purchased; a PO can only be corrected while the item is Purchased',
      v_item.name, public._purchase_request_item_status_label(v_item.status)
      using errcode = '22023';
  end if;
  if v_item.po_number is not distinct from v_po then
    raise exception 'purchase_request_correct_po: % is already on PO %', v_item.name, v_po using errcode = '22023';
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
  '#548/#549/#684: server-only (service role). Corrects the PO number on a Purchased item as the given signed-in Purchasing member, with Odoo''s answer (found / not_found / unreachable) turned into the verdict. Attaching a P0 is purchase_request_item_attach_po.';

revoke all on function public.purchase_request_item_apply_po_check(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.purchase_request_item_apply_po_check(text, uuid, text, text, text) to service_role;
