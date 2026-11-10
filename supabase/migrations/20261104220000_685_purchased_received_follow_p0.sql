-- 20261104220000_685_purchased_received_follow_p0.sql
-- #685 (spec #675): Purchased and Received follow the P0 in Odoo.
--
-- Every time a request opens, the odoo-po-sync edge function reads the attached P0s from
-- Odoo and calls purchase_request_sync_po_facts (service role only) with what Odoo said.
-- Each line with a P0 takes its stored status and delivery figures from it:
--   RFQ            -> To purchase (the "RFQ P0..." note)
--   confirmed P0   -> Purchased (always with a delivery note)
--   fully received -> Received
-- When Odoo does not answer, the function is never called and the stored values stay.
-- Purchased and Received are still refused by hand (see 20261104210000).
--
-- Additive columns; idempotent.

alter table public.purchase_request_items
  add column if not exists po_eta date,
  add column if not exists po_synced_at timestamptz;

comment on column public.purchase_request_items.po_eta is
  '#685: Odoo''s Expected Arrival on the attached P0, as a date. Null when Odoo has none ("no ETA set").';
comment on column public.purchase_request_items.po_synced_at is
  '#685: when the attached P0 was last read from Odoo.';

-- p_facts is a jsonb array of { item_id, state (rfq|confirmed), ordered, received, eta, bought_as }.
-- Items that are not on the request, have no P0, or are Cancelled are skipped. Returns how many
-- lines changed status.
create or replace function public.purchase_request_sync_po_facts(
  p_actor_email text,
  p_request_id uuid,
  p_facts jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_fact jsonb;
  v_item public.purchase_request_items;
  v_state text;
  v_ordered numeric;
  v_received numeric;
  v_eta date;
  v_bought text;
  v_to text;
  v_changed integer := 0;
begin
  if p_actor_email is null or btrim(p_actor_email) = '' then
    raise exception 'purchase_request_sync_po_facts: not signed in' using errcode = '42501';
  end if;
  if p_facts is null or jsonb_typeof(p_facts) <> 'array' then
    raise exception 'purchase_request_sync_po_facts: the facts must be a list' using errcode = '22023';
  end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('email', p_actor_email, 'role', 'authenticated')::text, true);

  v_actor := public.get_employee_id();
  if v_actor is null or public.purchase_request_actor_side(p_request_id) is null then
    raise exception 'purchase_request_sync_po_facts: not a member of this request' using errcode = '42501';
  end if;

  for v_fact in select * from jsonb_array_elements(p_facts) loop
    v_state := v_fact->>'state';
    continue when v_state is null or v_state not in ('rfq', 'confirmed');

    select * into v_item from public.purchase_request_items
     where id = (v_fact->>'item_id')::uuid and request_id = p_request_id
       for update;
    continue when v_item.id is null or v_item.po_number is null or v_item.status = 'cancelled';

    v_ordered := coalesce((v_fact->>'ordered')::numeric, 0);
    v_received := coalesce((v_fact->>'received')::numeric, 0);
    v_eta := nullif(v_fact->>'eta', '')::date;
    v_bought := nullif(btrim(v_fact->>'bought_as'), '');
    v_to := case
      when v_state = 'rfq' then 'to_purchase'
      when v_ordered > 0 and v_received >= v_ordered then 'received'
      else 'purchased'
    end;

    update public.purchase_request_items
       set status = v_to,
           status_changed_by = case when status is distinct from v_to then v_actor else status_changed_by end,
           status_changed_at = case when status is distinct from v_to then now() else status_changed_at end,
           po_state = v_state,
           po_ordered = v_ordered,
           po_received = v_received,
           po_eta = v_eta,
           bought_as = coalesce(v_bought, bought_as),
           po_synced_at = now()
     where id = v_item.id;

    if v_item.status is distinct from v_to then
      v_changed := v_changed + 1;
      perform public._purchase_request_post_event(
        p_request_id,
        v_actor,
        case v_to
          when 'to_purchase' then format('%s: RFQ %s; still To purchase.', v_item.name, v_item.po_number)
          else format('%s: P0 %s is %s in Odoo.', v_item.name, v_item.po_number,
                      lower(public._purchase_request_item_status_label(v_to)))
        end,
        jsonb_build_object('event', 'item_po_synced', 'item_id', v_item.id, 'from', v_item.status, 'to', v_to,
                           'po_number', v_item.po_number)
      );
    end if;
  end loop;

  return v_changed;
end;
$$;

comment on function public.purchase_request_sync_po_facts(text, uuid, jsonb) is
  '#685: server-only (service role). Sets each line''s stored status and delivery figures from the P0 facts the odoo-po-sync edge function read in Odoo, as the signed-in request member. Never called when Odoo did not answer, so the last values stay.';

revoke all on function public.purchase_request_sync_po_facts(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.purchase_request_sync_po_facts(text, uuid, jsonb) to service_role;
