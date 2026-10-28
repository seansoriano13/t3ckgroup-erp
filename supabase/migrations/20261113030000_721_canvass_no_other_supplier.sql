-- #721 (spec #718, ADR 0047): a Canvass has three supplier slots. An empty slot 2 or 3 can be
-- marked "No other supplier" with a reason (one reason may serve both slots). A winner can be
-- picked only when Offers plus explained empty slots number at least three; more than three
-- Offers stay allowed.
--
--   sor_canvass_no_other_supplier   one row per explained slot (2 or 3): reason, who, when
--   canvass_slots_covered(id)       Offers + explained slots still empty
--   canvass_set_no_other_supplier   mark slot(s) with one reason (re-marking replaces)
--   canvass_clear_no_other_supplier take a mark back off one slot
--   canvass_apply_winner            re-created: refuses under three covered slots (22023)
--
-- A mark only counts while its slot is still empty: slot n is empty while the Canvass has fewer
-- than n Offers. Adding Offers later never leaves a stale mark counting twice.
--
-- SAFE TO RUN AT ANY TIME: idempotent (create if not exists / create or replace).

create table if not exists public.sor_canvass_no_other_supplier (
  id         uuid primary key default gen_random_uuid(),
  canvass_id uuid not null references public.sor_canvasses (id) on delete cascade,
  slot       integer not null,
  reason     text not null,
  actor_id   uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint sor_canvass_no_other_supplier_slot_chk check (slot in (2, 3)),
  constraint sor_canvass_no_other_supplier_reason_chk check (length(btrim(reason)) > 0),
  constraint sor_canvass_no_other_supplier_one_per_slot unique (canvass_id, slot)
);

comment on table public.sor_canvass_no_other_supplier is
  '#721 (ADR 0047): a Canvass''s explained empty supplier slot (2 or 3): why there is no other supplier, who said so, when. Written only by canvass_set_no_other_supplier.';

alter table public.sor_canvass_no_other_supplier enable row level security;

drop policy if exists sor_canvass_no_other_supplier_read on public.sor_canvass_no_other_supplier;
create policy sor_canvass_no_other_supplier_read on public.sor_canvass_no_other_supplier
  for select to authenticated
  using (public.canvass_can_read(canvass_id));

revoke all on public.sor_canvass_no_other_supplier from public, anon, authenticated;
grant select on public.sor_canvass_no_other_supplier to authenticated;

-- Offers plus the explained slots that are still empty.
create or replace function public.canvass_slots_covered(p_canvass_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with o as (select count(*)::integer as n from public.sor_canvass_offers where canvass_id = p_canvass_id)
  select o.n + (
    select count(*)::integer from public.sor_canvass_no_other_supplier m
     where m.canvass_id = p_canvass_id and m.slot > o.n
  ) from o
$$;

revoke all on function public.canvass_slots_covered(uuid) from public, anon;
grant execute on function public.canvass_slots_covered(uuid) to authenticated;

create or replace function public.canvass_set_no_other_supplier(p_canvass_id uuid, p_slots integer[], p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_slots  integer[];
  v_offers integer;
  v_slot   integer;
begin
  if public.get_employee_id() is null then
    raise exception 'canvass_set_no_other_supplier: sign in first' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('canvass_winner:' || p_canvass_id::text));

  if not exists (select 1 from public.sor_canvasses where id = p_canvass_id) then
    raise exception 'canvass_set_no_other_supplier: not found' using errcode = 'P0002';
  end if;
  if not (public.canvass_can_write() and public.canvass_can_read(p_canvass_id)) then
    raise exception 'canvass_set_no_other_supplier: not allowed' using errcode = '42501';
  end if;
  if public.canvass_is_locked(p_canvass_id) then
    raise exception 'canvass_set_no_other_supplier: this Canvass is locked, so its slots can''t change' using errcode = '22023';
  end if;
  if v_reason = '' then
    raise exception 'canvass_set_no_other_supplier: say why there is no other supplier' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct s order by s), '{}') into v_slots from unnest(coalesce(p_slots, '{}')) s;
  if cardinality(v_slots) = 0 or exists (select 1 from unnest(v_slots) s where s not in (2, 3)) then
    raise exception 'canvass_set_no_other_supplier: only slot 2 or slot 3 can be marked' using errcode = '22023';
  end if;

  select count(*)::integer into v_offers from public.sor_canvass_offers where canvass_id = p_canvass_id;
  foreach v_slot in array v_slots loop
    if v_offers >= v_slot then
      raise exception 'canvass_set_no_other_supplier: slot % already has an Offer', v_slot using errcode = '22023';
    end if;
  end loop;

  foreach v_slot in array v_slots loop
    insert into public.sor_canvass_no_other_supplier (canvass_id, slot, reason, actor_id)
    values (p_canvass_id, v_slot, v_reason, public.get_employee_id())
    on conflict (canvass_id, slot)
    do update set reason = excluded.reason, actor_id = excluded.actor_id, created_at = now();
  end loop;

  return jsonb_build_object('canvass_id', p_canvass_id, 'slots', to_jsonb(v_slots),
                            'covered', public.canvass_slots_covered(p_canvass_id));
end;
$$;

revoke all on function public.canvass_set_no_other_supplier(uuid, integer[], text) from public, anon;
grant execute on function public.canvass_set_no_other_supplier(uuid, integer[], text) to authenticated;

create or replace function public.canvass_clear_no_other_supplier(p_canvass_id uuid, p_slot integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer;
begin
  if public.get_employee_id() is null then
    raise exception 'canvass_clear_no_other_supplier: sign in first' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('canvass_winner:' || p_canvass_id::text));

  if not exists (select 1 from public.sor_canvasses where id = p_canvass_id) then
    raise exception 'canvass_clear_no_other_supplier: not found' using errcode = 'P0002';
  end if;
  if not (public.canvass_can_write() and public.canvass_can_read(p_canvass_id)) then
    raise exception 'canvass_clear_no_other_supplier: not allowed' using errcode = '42501';
  end if;
  if public.canvass_is_locked(p_canvass_id) then
    raise exception 'canvass_clear_no_other_supplier: this Canvass is locked, so its slots can''t change' using errcode = '22023';
  end if;

  delete from public.sor_canvass_no_other_supplier where canvass_id = p_canvass_id and slot = p_slot;
  get diagnostics v_removed = row_count;

  return jsonb_build_object('canvass_id', p_canvass_id, 'slot', p_slot, 'cleared', v_removed > 0);
end;
$$;

revoke all on function public.canvass_clear_no_other_supplier(uuid, integer) from public, anon;
grant execute on function public.canvass_clear_no_other_supplier(uuid, integer) to authenticated;

-- canvass_apply_winner: latest definition (20261104180000) plus the three-slot refusal.
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

  -- #721 (ADR 0047): three slots, each an Offer or an explained "No other supplier".
  if public.canvass_slots_covered(p_canvass_id) < 3 then
    raise exception 'canvass_apply_winner: a winner needs three supplier slots filled or explained. Add an Offer or mark No other supplier with a reason'
      using errcode = '22023';
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
