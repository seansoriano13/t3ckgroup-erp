-- Spec #798 / ticket #804: an attach picks the P0 lines of the item's Odoo product.
--
-- The edge function (odoo-po-verify) now sends the P0 row ids it picked for the item (every row of the
-- P0 with the item's Odoo product; none when another open item shares the product or the item has no
-- product). They are stored in purchase_request_items.odoo_po_line_ids. When no ids are sent (null),
-- the old rule stays: a re-attach of a different P0 clears the lines picked on the old one.
--
-- Redefines purchase_request_item_attach_po from its latest body (20261118010000_802_attach_po_on_received.sql).
-- The only changes: the trailing parameter p_line_ids int[] default null, and the stored lines. The old
-- six-argument signature is dropped first so calls stay unambiguous (PostgREST matches named arguments).
--
-- Also adds purchase_request_item_po_line_rows: the Pick P0 line screen shows each line's product and
-- quantity. It reads the stored IPAS copy (ipas.odoo_copy->'lines'), as _ipas_po_line_ids does.

drop function if exists public.purchase_request_item_attach_po(text, uuid, text, jsonb, boolean, text);

create or replace function public.purchase_request_item_attach_po(
  p_actor_email text,
  p_item_id uuid,
  p_po_number text,
  p_facts jsonb,
  p_order_early boolean default false,
  p_order_early_reason text default null,
  p_line_ids int[] default null
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
  v_closed_stage text;
  v_early text;
  v_deal_owner uuid;
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
  if v_item.status = 'cancelled' then
    raise exception 'purchase_request_item_attach_po: nothing to attach to this line; % is %',
      v_item.name, public._purchase_request_item_status_label(v_item.status)
      using errcode = '22023';
  end if;

  -- #724: Buying opens here. Refused before the SOR has entered the flagged Stage unless ordered early with a reason.
  v_closed_stage := public._purchase_request_buying_closed_stage(v_item.request_id);
  if v_closed_stage is not null then
    if not coalesce(p_order_early, false) then
      raise exception 'purchase_request_item_attach_po: buying opens at % and this SOR has not reached it; choose Order early and give a reason to attach now', v_closed_stage
        using errcode = '22023', hint = 'buying_not_open';
    end if;
    v_early := nullif(btrim(coalesce(p_order_early_reason, '')), '');
    if v_early is null then
      raise exception 'purchase_request_item_attach_po: Order early needs a reason' using errcode = '22023';
    end if;
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
         -- A reason sent with an attach that was not early is ignored; an earlier one stays.
         ordered_early_reason = coalesce(v_early, ordered_early_reason),
         -- #804: the P0 rows the edge function picked for this item. Sent (even empty), they are stored as they are.
         -- Not sent: lines picked on another P0 do not carry over.
         odoo_po_line_ids = case
           when p_line_ids is not null then p_line_ids
           when po_number is distinct from v_po then '{}'
           else odoo_po_line_ids
         end
   where id = v_item.id
  returning * into v_item;

  v_text := case v_to
    when 'to_purchase' then format('%s: RFQ %s attached; still To purchase.', v_item.name, v_po)
    else format('%s: P0 %s attached; %s.', v_item.name, v_po, public._purchase_request_item_status_label(v_to))
  end;
  if v_early is not null then
    v_text := v_text || format(' Ordered early: %s', v_early);
  end if;
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
      'bought_as', v_bought,
      'ordered_early', v_early is not null,
      'ordered_early_reason', v_early
    )
  );

  -- Tell the Deal Owner that money is out before the Stage that opens buying.
  if v_early is not null then
    select o.deal_owner_id into v_deal_owner
      from public.purchase_requests r
      join public.sales_opportunities o on o.id = r.opportunity_id
     where r.id = v_item.request_id;
    perform public._purchase_request_notify(
      v_item.request_id, array[v_deal_owner], v_actor, 'PURCHASE_REQUEST_ORDERED_EARLY',
      'Ordered early on your deal',
      format('%s: %s was ordered before %s. Reason: %s', public._purchase_request_label(v_item.request_id), v_item.name, v_closed_stage, v_early),
      false
    );
  end if;

  return v_item;
end;
$$;

comment on function public.purchase_request_item_attach_po(text, uuid, text, jsonb, boolean, text, int[]) is
  '#804: attaches a P0 to a Requested Item from its Odoo facts (#684) and stores the P0 rows picked for the item''s product (p_line_ids). Refuses a Cancelled item, and a line whose buying has not opened without Order early (#724). Service role only; the odoo-po-verify edge function calls it.';

revoke all on function public.purchase_request_item_attach_po(text, uuid, text, jsonb, boolean, text, int[]) from public, anon, authenticated;
grant execute on function public.purchase_request_item_attach_po(text, uuid, text, jsonb, boolean, text, int[]) to service_role;

-- #804: the P0 lines of an item's PO, with each line's product name and quantity, for the Pick P0 line
-- screen. Read from the live IPAS copy (not cancelled), the same source _ipas_po_line_ids reads ids from.
-- Returns a jsonb array of {line_id, product_name, quantity}. Empty with no PO number or while the PO has no IPAS.
create or replace function public.purchase_request_item_po_line_rows(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item public.purchase_request_items;
begin
  if public.get_employee_id() is null then
    raise exception 'purchase_request_item_po_line_rows: not signed in' using errcode = '42501';
  end if;
  select * into v_item from public.purchase_request_items where id = p_item_id;
  if v_item.id is null or not public.can_read_purchase_request(v_item.request_id) then
    raise exception 'purchase_request_item_po_line_rows: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if v_item.po_number is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'line_id', (l.line->>'line_id')::int,
               'product_name', coalesce(l.line->>'name', ''),
               'quantity', coalesce((l.line->>'quantity')::numeric, 0)
             )
             order by (l.line->>'line_id')::int
           )
      from public.ipas i
     cross join lateral jsonb_array_elements(
       case when jsonb_typeof(i.odoo_copy->'lines') = 'array' then i.odoo_copy->'lines' else '[]'::jsonb end
     ) as l(line)
     where i.po_number = v_item.po_number
       and i.state <> 'cancelled'
       and (l.line->>'line_id') ~ '^[0-9]+$'
  ), '[]'::jsonb);
end;
$$;

comment on function public.purchase_request_item_po_line_rows(uuid) is
  '#804: the P0 lines on the live IPAS copy of an item''s PO, as {line_id, product_name, quantity} rows, for the Pick P0 line screen. Empty with no PO number or while the PO has no IPAS.';

revoke all on function public.purchase_request_item_po_line_rows(uuid) from public, anon;
grant execute on function public.purchase_request_item_po_line_rows(uuid) to authenticated;
