-- ==============================================================================
-- 20261104180000_canvass_from_product_line.sql
--
-- #682 (spec #675): Canvass from a product line.
--
-- 1. Starting a Canvass on a product line (a Requested Item) moves the line to
--    Still canvassing by itself, from Not checked, Available, To purchase or
--    Cannot source. A line that is Cancelled, bought (Purchased, Received) or
--    already Still canvassing is left alone. The move is recorded in the item's
--    history and the request's chat like any status change.
-- 2. A winner picked on a product line's Canvass fills the Acquire of the
--    Component linked to the line's SOR line (Component -> Tender Line ->
--    SOR line). Fixes the bug where, since the Canvass button left the Costing
--    Desk's product detail, no winner reached the matrix. Only when exactly one
--    Component hangs off the line; with none or several nothing is guessed.
--
-- A Canvass is never overwritten: one Canvass per subject (unique index), so a
-- second start on the same line adds Offers to it; nothing here rewrites Offers,
-- winner or reason.
-- ==============================================================================

create or replace function public.sor_canvasses_mark_canvassing()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := coalesce(public.get_employee_id(), new.created_by);
  v_item  public.purchase_request_items;
begin
  for v_item in
    select i.*
      from public.purchase_request_items i
     where i.status in ('not_checked', 'available', 'to_purchase', 'cannot_source')
       and (i.id = new.requested_item_id
            or (new.component_id is not null and i.component_id = new.component_id))
       for update
  loop
    update public.purchase_request_items
       set status = 'still_canvassing',
           status_changed_by = v_actor,
           status_changed_at = now()
     where id = v_item.id;

    if v_actor is not null then
      perform public._purchase_request_post_event(
        v_item.request_id,
        v_actor,
        format('%s: %s → Still canvassing.', v_item.name, public._purchase_request_item_status_label(v_item.status)),
        jsonb_build_object(
          'event', 'item_status_changed',
          'item_id', v_item.id,
          'from', v_item.status,
          'to', 'still_canvassing',
          'changed_by', v_actor,
          'changed_at', now()
        )
      );
    end if;
  end loop;
  return null;
end
$function$;

revoke all on function public.sor_canvasses_mark_canvassing() from public, anon, authenticated;

-- The Component linked to a product line, or null when there is none or more than one.
create or replace function public._canvass_item_component(p_requested_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when count(*) = 1 then (array_agg(c.id))[1] end
    from public.purchase_request_items i
    join public.costing_tender_lines l on l.sor_item_id = i.sor_item_id
    join public.costing_components c on c.tender_line_id = l.id
   where i.id = p_requested_item_id
     and i.sor_item_id is not null;
$$;

revoke all on function public._canvass_item_component(uuid) from public, anon, authenticated;

create or replace function public.canvass_apply_winner(p_canvass_id uuid, p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := public.get_employee_id();
  v_canvass  public.sor_canvasses;
  v_offer    public.sor_canvass_offers;
  v_price    numeric;
  v_rate     numeric;
  v_acquire  numeric;
  v_comp     public.costing_components;
  v_cost     public.costing_component_costs;
  v_filled   jsonb := jsonb_build_object('acquire', false, 'offer_specification', false, 'documents', false);
  v_kept     jsonb;
  v_docs     jsonb;
  v_spec     boolean;
  v_component_id uuid;
begin
  if v_actor is null then
    raise exception 'canvass_apply_winner: sign in first' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('canvass_winner:' || p_canvass_id::text));

  select * into v_canvass from public.sor_canvasses where id = p_canvass_id;
  if not found then
    raise exception 'canvass_apply_winner: not found' using errcode = 'P0002';
  end if;
  if not (public.canvass_can_write() and public.canvass_can_read(p_canvass_id)) then
    raise exception 'canvass_apply_winner: not allowed' using errcode = '42501';
  end if;

  select * into v_offer from public.sor_canvass_offers where id = p_offer_id and canvass_id = p_canvass_id;
  if not found then
    raise exception 'canvass_apply_winner: that Offer is not on this Canvass' using errcode = 'P0002';
  end if;

  select p.unit_price, p.comparison_rate into v_price, v_rate
    from public.sor_canvass_offer_prices p where p.offer_id = p_offer_id;

  if v_offer.currency <> 'PHP' and v_rate is null then
    raise exception 'canvass_apply_winner: a % Offer needs its comparison rate before it can win', v_offer.currency
      using errcode = '22023';
  end if;

  -- One winner: the old one goes first.
  update public.sor_canvass_offers set is_winner = false
    where canvass_id = p_canvass_id and is_winner and id <> p_offer_id;
  update public.sor_canvass_offers set is_winner = true
    where id = p_offer_id and not is_winner;

  -- A Canvass on a product line fills the Component linked to the line's SOR line (#682).
  v_component_id := v_canvass.component_id;
  if v_component_id is null and v_canvass.requested_item_id is not null then
    v_component_id := public._canvass_item_component(v_canvass.requested_item_id);
  end if;
  if v_component_id is null then
    return jsonb_build_object('offer_id', p_offer_id, 'filled', v_filled);
  end if;

  select * into v_comp from public.costing_components where id = v_component_id for update;
  if not found then
    raise exception 'canvass_apply_winner: not found' using errcode = 'P0002';
  end if;
  select * into v_cost from public.costing_component_costs where component_id = v_component_id;

  -- Writes below are the caller's own (auth.uid() is still the caller), so the band triggers judge
  -- them; the flag only tells the mark-nulling trigger this is the fill.
  perform set_config('canvass.fill', 'on', true);

  -- Acquire unit: the price as quoted, or price x comparison rate, to the centavo.
  if v_price is not null then
    v_acquire := round(case when v_offer.currency = 'PHP' then v_price else v_price * v_rate end, 2);
    if v_cost.acquire_from_offer_id is not null or v_cost.acquire_unit is null then
      perform public.costing_set_money(
        'costing_component_costs', v_component_id,
        jsonb_build_object('acquire_unit', v_acquire, 'acquire_from_offer_id', p_offer_id)
      );
      v_filled := v_filled || jsonb_build_object('acquire', true);
    end if;
  elsif v_cost.acquire_from_offer_id is not null then
    -- The figure came from an earlier winner and this one has no price: keep the figure, drop
    -- the claim that the Canvass backs it.
    perform public.costing_set_money(
      'costing_component_costs', v_component_id,
      jsonb_build_object('acquire_from_offer_id', null)
    );
  end if;

  -- Offer Specification: the Offer's description; documents: its brochure, cited.
  v_spec := nullif(btrim(coalesce(v_offer.description, '')), '') is not null
    and (v_comp.offer_specification_from_offer_id is not null
         or nullif(btrim(coalesce(v_comp.offer_specification, '')), '') is null);

  -- Citations of this Canvass's Offers are the Canvass's to replace; anything else is the user's.
  select coalesce(jsonb_agg(d), '[]'::jsonb) into v_kept
    from jsonb_array_elements(case when jsonb_typeof(v_comp.documents) = 'array' then v_comp.documents else '[]'::jsonb end) d
    where not (d ? 'offer_id' and (d ->> 'offer_id') in (
      select o.id::text from public.sor_canvass_offers o where o.canvass_id = p_canvass_id
    ));
  v_docs := v_kept || coalesce((
    select jsonb_agg(b || jsonb_build_object('offer_id', p_offer_id))
    from jsonb_array_elements(case when jsonb_typeof(v_offer.brochure) = 'array' then v_offer.brochure else '[]'::jsonb end) b
  ), '[]'::jsonb);

  if v_spec then
    update public.costing_components
       set offer_specification = btrim(v_offer.description),
           offer_specification_from_offer_id = p_offer_id
     where id = v_component_id;
    v_filled := v_filled || jsonb_build_object('offer_specification', true);
  elsif v_comp.offer_specification_from_offer_id is not null
        and nullif(btrim(coalesce(v_offer.description, '')), '') is null then
    -- Same as Acquire: the text stays, the "from Canvass" claim goes.
    update public.costing_components
       set offer_specification_from_offer_id = null
     where id = v_component_id;
  end if;

  if v_docs is distinct from v_comp.documents then
    update public.costing_components set documents = v_docs where id = v_component_id;
    v_filled := v_filled || jsonb_build_object('documents', true);
  end if;

  perform set_config('canvass.fill', 'off', true);

  return jsonb_build_object('offer_id', p_offer_id, 'filled', v_filled);
end;
$$;

revoke all on function public.canvass_apply_winner(uuid, uuid) from public, anon;
grant execute on function public.canvass_apply_winner(uuid, uuid) to authenticated;
