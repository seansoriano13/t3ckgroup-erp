-- Canvass: the winner fills the Costing Matrix (#278, spec #275).
--
-- WHAT THIS ADDS
--   costing_components.offer_specification_from_offer_id
--   costing_component_costs.acquire_from_offer_id
--                          which winning Offer a field was filled from. Nulled whenever the field
--                          changes by any route other than canvass_apply_winner, so the matrix
--                          says "from Canvass" only while that is still true.
--   costing_components.documents
--                          jsonb [{ url, name, type, bytes, offer_id? }], Purchasing band. A winner's
--                          brochure is cited here (offer_id set), not uploaded a second time.
--   canvass_apply_winner(canvass_id, offer_id)
--                          clears the old winner, sets the new one, and on a Component subject fills
--                          Acquire (price x comparison rate for a foreign quote), Offer Specification
--                          and the brochure citation, as the caller, so the Costing Matrix band
--                          triggers apply. A field whose mark is empty because someone typed over it
--                          is left alone, unless it has no value yet.
--   costing_accept_brand(component_id)
--                          Sales band: copies the winning Offer's brand into Brand. A Canvass only
--                          ever proposes a brand.
--
-- A fill that changes Offer Specification clears "Evaluation approved" through #271's trigger, the
-- same as a hand edit. A Canvass on a Requested Item fills nothing.
--
-- SAFE TO RUN AT ANY TIME: idempotent.

-- ---------------------------------------------------------------------------
-- Columns (additive; the fake database reads up to the marker below)
-- ---------------------------------------------------------------------------

alter table public.costing_components
  add column if not exists offer_specification_from_offer_id uuid references public.sor_canvass_offers (id) on delete set null,
  add column if not exists documents jsonb not null default '[]'::jsonb;

alter table public.costing_component_costs
  add column if not exists acquire_from_offer_id uuid references public.sor_canvass_offers (id) on delete set null;

comment on column public.costing_components.offer_specification_from_offer_id is
  '#278: the winning Offer this Offer Specification was filled from. Nulled when the specification changes outside canvass_apply_winner.';
comment on column public.costing_components.documents is
  '#278: documents on the Component, [{ url, name, type, bytes, offer_id? }]. An entry with offer_id cites that Offer''s brochure.';
comment on column public.costing_component_costs.acquire_from_offer_id is
  '#278: the winning Offer this Acquire was filled from. Nulled when Acquire changes outside canvass_apply_winner.';

-- Functions
-- ---------------------------------------------------------------------------
-- Registry rows: the new columns read and write like the data columns they mark
-- ---------------------------------------------------------------------------

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_components', 'offer_specification_from_offer_id', '{participant,price,cost,closed_book}'),
  ('costing_components', 'documents', '{participant,price,cost,closed_book}'),
  ('costing_component_costs', 'acquire_from_offer_id', '{cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_components', 'offer_specification_from_offer_id', '{purchasing}'),
  ('costing_components', 'documents', '{purchasing}'),
  ('costing_component_costs', 'acquire_from_offer_id', '{purchasing}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

-- ---------------------------------------------------------------------------
-- A mark goes when its field is changed by hand
-- ---------------------------------------------------------------------------

-- canvass_apply_winner sets the transaction-local flag canvass.fill while it writes. Any other
-- change to the field nulls the mark. Named so it fires after the band trigger (costing_bands).
create or replace function public.canvass_null_fill_mark()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('canvass.fill', true), '') = 'on' then
    return new;
  end if;
  if tg_table_name = 'costing_components' then
    if new.offer_specification is distinct from old.offer_specification then
      new.offer_specification_from_offer_id := null;
    end if;
  elsif new.acquire_unit is distinct from old.acquire_unit then
    new.acquire_from_offer_id := null;
  end if;
  return new;
end
$$;

drop trigger if exists trg_canvass_null_fill_mark on public.costing_components;
create trigger trg_canvass_null_fill_mark
  before update of offer_specification on public.costing_components
  for each row execute function public.canvass_null_fill_mark();

drop trigger if exists trg_canvass_null_fill_mark on public.costing_component_costs;
create trigger trg_canvass_null_fill_mark
  before update of acquire_unit on public.costing_component_costs
  for each row execute function public.canvass_null_fill_mark();

-- ---------------------------------------------------------------------------
-- canvass_apply_winner
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
-- costing_accept_brand
-- ---------------------------------------------------------------------------

create or replace function public.costing_accept_brand(p_component_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp   uuid;
  v_brand text;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_accept_brand: sign in first' using errcode = '42501';
  end if;

  v_opp := public.canvass_component_opportunity(p_component_id);
  if v_opp is null then
    raise exception 'costing_accept_brand: not found' using errcode = 'P0002';
  end if;
  if not (public.costing_can_read(v_opp) and public.costing_in_band(v_opp, 'sales')) then
    raise exception 'costing_accept_brand: only the Deal Team can accept a brand' using errcode = '42501';
  end if;

  select nullif(btrim(coalesce(o.brand, '')), '') into v_brand
    from public.sor_canvasses c
    join public.sor_canvass_offers o on o.canvass_id = c.id and o.is_winner
   where c.component_id = p_component_id;
  if v_brand is null then
    raise exception 'costing_accept_brand: the Canvass has no winning brand' using errcode = '55000';
  end if;

  -- As the caller, so the Sales band trigger judges the write too.
  update public.costing_components set brand = v_brand where id = p_component_id;

  return jsonb_build_object('brand', v_brand);
end;
$$;

revoke all on function public.costing_accept_brand(uuid) from public, anon;
grant execute on function public.costing_accept_brand(uuid) to authenticated;
