-- Canvass review fixes (spec #275): three changes found in review.
--
-- WHAT THIS DOES
--   canvass_add_offer(canvass_id, offer, price)
--                          one call adds an Offer and its prices row together, as the caller
--                          (security invoker, so the Canvass row policies still judge both
--                          inserts). Replaces a client-side insert, insert and compensating delete.
--   canvass_apply_winner   re-created. A field still marked "from Canvass" for an earlier winner,
--                          when the new winner has no price (Acquire) or a blank description
--                          (Offer Specification), now loses the mark and keeps its value. Before,
--                          the matrix kept saying "from Canvass" for a figure the winner no
--                          longer backs.
--   sor_canvasses_mark_canvassing()
--                          after a Canvass is opened, each Requested Item that is its subject, or
--                          that names its subject Component, moves from To order to Canvassing
--                          (the allowed forward step). An item at any other status is left alone.
--
-- SAFE TO RUN AT ANY TIME: functions are re-created, the trigger is dropped and re-created.

-- Functions

-- ---------------------------------------------------------------------------
-- canvass_add_offer
-- ---------------------------------------------------------------------------

create or replace function public.canvass_add_offer(p_canvass_id uuid, p_offer jsonb, p_price jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_offer public.sor_canvass_offers;
begin
  p_offer := coalesce(p_offer, '{}'::jsonb);
  p_price := coalesce(p_price, '{}'::jsonb);

  insert into public.sor_canvass_offers (
    canvass_id, supplier_name, odoo_supplier_id, brand, description, source_link, brochure,
    remarks, lead_time, quality_note, currency, valid_until, sort_order, created_by
  ) values (
    p_canvass_id,
    p_offer ->> 'supplier_name',
    nullif(p_offer ->> 'odoo_supplier_id', '')::integer,
    p_offer ->> 'brand',
    p_offer ->> 'description',
    p_offer ->> 'source_link',
    case when jsonb_typeof(p_offer -> 'brochure') = 'array' then p_offer -> 'brochure' else '[]'::jsonb end,
    p_offer ->> 'remarks',
    p_offer ->> 'lead_time',
    p_offer ->> 'quality_note',
    coalesce(nullif(p_offer ->> 'currency', ''), 'PHP'),
    nullif(p_offer ->> 'valid_until', '')::date,
    (select count(*)::integer from public.sor_canvass_offers where canvass_id = p_canvass_id),
    nullif(p_offer ->> 'created_by', '')::uuid
  )
  returning * into v_offer;

  insert into public.sor_canvass_offer_prices (offer_id, unit_price, comparison_rate)
  values (
    v_offer.id,
    nullif(p_price ->> 'unit_price', '')::numeric,
    nullif(p_price ->> 'comparison_rate', '')::numeric
  );

  return to_jsonb(v_offer);
end;
$$;

revoke all on function public.canvass_add_offer(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.canvass_add_offer(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- canvass_apply_winner: a stale "from Canvass" mark goes
-- ---------------------------------------------------------------------------

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

  -- A Canvass on a Requested Item fills nothing: there is no matrix row.
  if v_canvass.component_id is null then
    return jsonb_build_object('offer_id', p_offer_id, 'filled', v_filled);
  end if;

  select * into v_comp from public.costing_components where id = v_canvass.component_id for update;
  if not found then
    raise exception 'canvass_apply_winner: not found' using errcode = 'P0002';
  end if;
  select * into v_cost from public.costing_component_costs where component_id = v_canvass.component_id;

  -- Writes below are the caller's own (auth.uid() is still the caller), so the band triggers judge
  -- them; the flag only tells the mark-nulling trigger this is the fill.
  perform set_config('canvass.fill', 'on', true);

  -- Acquire unit: the price as quoted, or price x comparison rate, to the centavo.
  if v_price is not null then
    v_acquire := round(case when v_offer.currency = 'PHP' then v_price else v_price * v_rate end, 2);
    if v_cost.acquire_from_offer_id is not null or v_cost.acquire_unit is null then
      perform public.costing_set_money(
        'costing_component_costs', v_canvass.component_id,
        jsonb_build_object('acquire_unit', v_acquire, 'acquire_from_offer_id', p_offer_id)
      );
      v_filled := v_filled || jsonb_build_object('acquire', true);
    end if;
  elsif v_cost.acquire_from_offer_id is not null then
    -- The figure came from an earlier winner and this one has no price: keep the figure, drop
    -- the claim that the Canvass backs it.
    perform public.costing_set_money(
      'costing_component_costs', v_canvass.component_id,
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
     where id = v_canvass.component_id;
    v_filled := v_filled || jsonb_build_object('offer_specification', true);
  elsif v_comp.offer_specification_from_offer_id is not null
        and nullif(btrim(coalesce(v_offer.description, '')), '') is null then
    -- Same as Acquire: the text stays, the "from Canvass" claim goes.
    update public.costing_components
       set offer_specification_from_offer_id = null
     where id = v_canvass.component_id;
  end if;

  if v_docs is distinct from v_comp.documents then
    update public.costing_components set documents = v_docs where id = v_canvass.component_id;
    v_filled := v_filled || jsonb_build_object('documents', true);
  end if;

  perform set_config('canvass.fill', 'off', true);

  return jsonb_build_object('offer_id', p_offer_id, 'filled', v_filled);
end;
$$;

revoke all on function public.canvass_apply_winner(uuid, uuid) from public, anon;
grant execute on function public.canvass_apply_winner(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Canvassing status: opening a Canvass moves its Requested Items on
-- ---------------------------------------------------------------------------

-- Security definer: whoever opens the Canvass (Purchasing access) may not hold an update right on
-- the item. The move goes through the function the status RPC uses, so the item's history and the
-- request's chat record it like any other status change. With no signed-in employee and no
-- creator the status is set directly.
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
     where i.status = 'to_order'
       and (i.id = new.requested_item_id
            or (new.component_id is not null and i.component_id = new.component_id))
       for update
  loop
    if v_actor is null then
      update public.purchase_request_items
         set status = 'canvassing', status_changed_at = now()
       where id = v_item.id;
    else
      perform public._purchase_request_item_move(v_item, 'canvassing', 'purchasing', v_actor, '{}'::jsonb, 'canvass');
    end if;
  end loop;
  return null;
end
$function$;

revoke all on function public.sor_canvasses_mark_canvassing() from public, anon, authenticated;

drop trigger if exists trg_sor_canvasses_mark_canvassing on public.sor_canvasses;
create trigger trg_sor_canvasses_mark_canvassing
  after insert on public.sor_canvasses
  for each row execute function public.sor_canvasses_mark_canvassing();
