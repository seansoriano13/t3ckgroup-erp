-- #969 (spec #956): the rules of a Canvass, restated for one Canvass per Purchase Request.
-- #967 made the tables; this makes the database refuse what the rules refuse.
--
--   Winner per line      request_canvass_winners is keyed by line, so a line has one winner; picking
--                        another replaces it. A winner is a supplier that quoted the line (the key
--                        points at the quote), has a reason, and is never on a cancelled line.
--                        Un-picking deletes the row and leaves what the winner filled in place.
--   Three suppliers      no winner until the Canvass has three suppliers, or a "No other supplier"
--                        note covers the missing second and third. The note is refused on a Canvass
--                        with no supplier (the first can't be explained away) or with three already,
--                        and can't be taken off while a winner depends on it.
--   Still canvassing     saving a supplier's price on a line moves the line to Still canvassing.
--   Lock                 a line marked Purchased (or Received) can't change its quoted prices, its
--                        quotes, its winner or its reason. Other lines stay open; brochures
--                        (attachments) stay open. A Super Admin lifts it for one line with a reason
--                        kept in request_canvass_line_unlocks. People are stopped; the service role
--                        (maintenance scripts) is not.
--   What a winner fills  the Component linked to the line (Acquire, Offer Specification,
--                        documents), and the line's price on the request. The Brand a winner quotes
--                        is read by costing_accept_brand (Sales accepts it; nothing is written here).
--   Canvasser            one per Canvass, defaulting to the request's Purchasing Incharge.
--   Offer projection     canvass_offer_projection, per quote, for the tiers that see the Closed Book.
--
-- Shortcuts: canvass_pick_supplier_for_all and canvass_use_same_reason.
-- Acquire and Offer Specification pointers now point at the winning quote (on delete set null).

-- ---------------------------------------------------------------------------------------------
-- 1. Pointers from the Costing Matrix to the winning quote
-- ---------------------------------------------------------------------------------------------

update public.costing_component_costs
   set acquire_from_offer_id = null
 where acquire_from_offer_id is not null
   and not exists (select 1 from public.request_canvass_quotes q where q.id = acquire_from_offer_id);

update public.costing_components
   set offer_specification_from_offer_id = null
 where offer_specification_from_offer_id is not null
   and not exists (select 1 from public.request_canvass_quotes q where q.id = offer_specification_from_offer_id);

alter table public.costing_component_costs
  add constraint costing_component_costs_acquire_from_offer_id_fkey
  foreign key (acquire_from_offer_id) references public.request_canvass_quotes (id) on delete set null;
alter table public.costing_components
  add constraint costing_components_offer_specification_from_offer_id_fkey
  foreign key (offer_specification_from_offer_id) references public.request_canvass_quotes (id) on delete set null;

-- ---------------------------------------------------------------------------------------------
-- 2. The lock and its history
-- ---------------------------------------------------------------------------------------------

create table public.request_canvass_line_unlocks (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.purchase_request_items (id) on delete cascade,
  reason     text not null,
  actor_id   uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint request_canvass_line_unlocks_reason_chk check (length(btrim(reason)) > 0)
);

create index request_canvass_line_unlocks_item_idx on public.request_canvass_line_unlocks (item_id, created_at desc);

comment on table public.request_canvass_line_unlocks is
  '#969: a Super Admin lifting the lock on one Purchased line of a Canvass, with the reason. Append-only; written by canvass_unlock_line.';

alter table public.request_canvass_line_unlocks enable row level security;
create policy request_canvass_line_unlocks_read on public.request_canvass_line_unlocks
  for select to authenticated using (public.canvass_item_can_read(item_id));
revoke all on public.request_canvass_line_unlocks from public, anon, authenticated;
grant select on public.request_canvass_line_unlocks to authenticated;

-- A line is locked while it is Purchased (or Received after it) and nobody has lifted the lock since
-- it got that status. A later status change locks it again.
create or replace function public.canvass_item_is_locked(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select i.status in ('purchased', 'received')
       and not exists (
         select 1 from public.request_canvass_line_unlocks u
          where u.item_id = i.id
            and u.created_at >= coalesce(i.status_changed_at, '-infinity'::timestamptz)
       )
      from public.purchase_request_items i
     where i.id = p_item_id
  ), false)
$$;

-- The lock stops people, not the service role or a job with no user (clean-ups, the demo reset).
create or replace function public.canvass_lock_applies()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role'
$$;

create or replace function public.request_canvass_quotes_guard_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item uuid := case when tg_op = 'DELETE' then old.item_id else new.item_id end;
begin
  if not public.canvass_lock_applies()
     or not exists (select 1 from public.purchase_request_items where id = v_item)
     or not public.canvass_item_is_locked(v_item) then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' and exists (
    select 1 from public.request_canvass_quotes q where q.supplier_id = new.supplier_id and q.item_id = new.item_id
  ) then
    -- An upsert onto a quote already there is judged when it updates.
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.brand, new.description, new.source_link, new.remarks, new.supplier_id, new.item_id, new.canvass_id)
        is not distinct from (old.brand, old.description, old.source_link, old.remarks, old.supplier_id, old.item_id, old.canvass_id) then
    -- Only the brochure moved: attachments stay open on a locked line.
    return new;
  end if;

  raise exception 'This line is Purchased, so its quotes, prices, winner and reason can''t change. A Super Admin can unlock it.'
    using errcode = '55000';
end
$$;

create or replace function public.request_canvass_quote_prices_guard_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote uuid := case when tg_op = 'DELETE' then old.quote_id else new.quote_id end;
  v_item  uuid;
begin
  if not public.canvass_lock_applies() then
    return coalesce(new, old);
  end if;
  select q.item_id into v_item from public.request_canvass_quotes q where q.id = v_quote;
  -- The quote is gone (it was removed, or its line was): its own guard has spoken.
  if v_item is null or not public.canvass_item_is_locked(v_item) then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' and exists (select 1 from public.request_canvass_quote_prices p where p.quote_id = new.quote_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.unit_price is not distinct from old.unit_price then
    return new;
  end if;

  raise exception 'This line is Purchased, so its prices can''t change. A Super Admin can unlock it.'
    using errcode = '55000';
end
$$;

create trigger trg_request_canvass_quotes_guard_locked before insert or update or delete on public.request_canvass_quotes
  for each row execute function public.request_canvass_quotes_guard_locked();
create trigger trg_request_canvass_quote_prices_guard_locked before insert or update or delete on public.request_canvass_quote_prices
  for each row execute function public.request_canvass_quote_prices_guard_locked();

-- A Super Admin lifts the lock on one line, with the reason, kept in the history and on the request.
create or replace function public.canvass_unlock_line(p_item_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_item   public.purchase_request_items;
begin
  if public.get_employee_id() is null then
    raise exception 'canvass_unlock_line: sign in first' using errcode = '42501';
  end if;
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'canvass_unlock_line: only a Super Admin can unlock a line' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'canvass_unlock_line: say why it is being unlocked' using errcode = '22023';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if not found then
    raise exception 'canvass_unlock_line: not found' using errcode = 'P0002';
  end if;
  if not public.canvass_item_is_locked(p_item_id) then
    return jsonb_build_object('item_id', p_item_id, 'unlocked', false);
  end if;

  insert into public.request_canvass_line_unlocks (item_id, reason, actor_id)
  values (p_item_id, v_reason, public.get_employee_id());

  perform public._purchase_request_post_event(
    v_item.request_id,
    public.get_employee_id(),
    format('%s: Canvass unlocked. %s', v_item.name, v_reason),
    jsonb_build_object('event', 'canvass_line_unlocked', 'item_id', p_item_id, 'reason', v_reason)
  );

  return jsonb_build_object('item_id', p_item_id, 'unlocked', true);
end
$$;

grant execute on function public.canvass_item_is_locked(uuid) to authenticated;
grant execute on function public.canvass_unlock_line(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Three suppliers, or a "No other supplier" note
-- ---------------------------------------------------------------------------------------------

create or replace function public.canvass_suppliers_covered(p_canvass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select s.n >= 3
      or (s.n >= 1 and exists (select 1 from public.request_canvass_no_other_supplier m where m.canvass_id = p_canvass_id))
    from (select count(*)::integer as n from public.request_canvass_suppliers where canvass_id = p_canvass_id) s
$$;

grant execute on function public.canvass_suppliers_covered(uuid) to authenticated;

create or replace function public.request_canvass_no_other_supplier_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canvass uuid := case when tg_op = 'DELETE' then old.canvass_id else new.canvass_id end;
  v_count   integer;
begin
  -- The Canvass is going (a cascade): nothing left to protect.
  if not exists (select 1 from public.request_canvasses where id = v_canvass) then
    return coalesce(new, old);
  end if;
  select count(*)::integer into v_count from public.request_canvass_suppliers where canvass_id = v_canvass;

  if tg_op = 'DELETE' then
    if v_count < 3 and exists (
      select 1
        from public.request_canvass_winners w
        join public.purchase_request_items i on i.id = w.item_id
        join public.request_canvasses c on c.request_id = i.request_id
       where c.id = v_canvass
    ) then
      raise exception 'A winner depends on this note. Take the winners off first, or add the missing suppliers.'
        using errcode = '22023';
    end if;
    return old;
  end if;

  if v_count = 0 then
    raise exception 'The first supplier can''t be explained away. Add a supplier first.' using errcode = '22023';
  end if;
  if v_count >= 3 then
    raise exception 'This Canvass already has three suppliers, so there is nothing to explain.' using errcode = '22023';
  end if;
  return new;
end
$$;

create trigger trg_request_canvass_no_other_supplier_guard before insert or update or delete on public.request_canvass_no_other_supplier
  for each row execute function public.request_canvass_no_other_supplier_guard();

-- ---------------------------------------------------------------------------------------------
-- 4. Winners
-- ---------------------------------------------------------------------------------------------

create or replace function public.request_canvass_winners_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item   uuid := case when tg_op = 'DELETE' then old.item_id else new.item_id end;
  v_status text;
  v_canvass uuid;
begin
  select i.status into v_status from public.purchase_request_items i where i.id = v_item;
  -- The line is going (a cascade): nothing left to protect.
  if not found then
    return coalesce(new, old);
  end if;

  if public.canvass_lock_applies() and public.canvass_item_is_locked(v_item) then
    raise exception 'This line is Purchased, so its winner and reason can''t change. A Super Admin can unlock it.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if v_status = 'cancelled' then
    raise exception 'A cancelled line can''t get a winner.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(new.reason, ''))) = 0 then
    raise exception 'A winner needs a reason.' using errcode = '22023';
  end if;

  select q.canvass_id into v_canvass
    from public.request_canvass_quotes q
   where q.supplier_id = new.supplier_id and q.item_id = new.item_id;
  if v_canvass is null then
    raise exception 'That supplier did not quote this line.' using errcode = '23503';
  end if;
  if not public.canvass_suppliers_covered(v_canvass) then
    raise exception 'A winner needs three suppliers, or a No other supplier note for the missing ones.' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.chosen_by := coalesce(new.chosen_by, public.get_employee_id());
  end if;
  new.reason := btrim(new.reason);
  return new;
end
$$;

create trigger trg_request_canvass_winners_guard before insert or update or delete on public.request_canvass_winners
  for each row execute function public.request_canvass_winners_guard();

-- What a winner fills: the Component linked to the line (only what is the Canvass's to fill, never
-- over a figure or text a person typed), and the line's price on the request.
create or replace function public.canvass_fill_from_winner(p_item_id uuid, p_supplier_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote    public.request_canvass_quotes;
  v_supplier public.request_canvass_suppliers;
  v_price    numeric;
  v_rate     numeric;
  v_acquire  numeric;
  v_component uuid;
  v_opp      uuid;
  v_comp     public.costing_components;
  v_cost     public.costing_component_costs;
  v_filled   jsonb := jsonb_build_object('acquire', false, 'offer_specification', false, 'documents', false, 'item_price', false);
  v_kept     jsonb;
  v_docs     jsonb;
  v_spec     boolean;
begin
  select * into v_quote from public.request_canvass_quotes where supplier_id = p_supplier_id and item_id = p_item_id;
  if not found then
    return v_filled;
  end if;
  select * into v_supplier from public.request_canvass_suppliers where id = p_supplier_id;
  select p.unit_price into v_price from public.request_canvass_quote_prices p where p.quote_id = v_quote.id;
  select sp.comparison_rate into v_rate from public.request_canvass_supplier_prices sp where sp.supplier_id = p_supplier_id;

  if v_price is not null then
    v_acquire := case
      when v_supplier.currency = 'PHP' then round(v_price, 2)
      when v_rate is not null then round(v_price * v_rate, 2)
    end;
  end if;

  -- The line's price on the request is the winner's, as quoted. No price, no stale one.
  if v_price is not null then
    insert into public.purchase_request_item_prices (item_id, unit_price, currency, comparison_rate)
    values (p_item_id, v_price, v_supplier.currency, case when v_supplier.currency = 'PHP' then null else v_rate end)
    on conflict (item_id) do update
      set unit_price = excluded.unit_price,
          currency = excluded.currency,
          comparison_rate = excluded.comparison_rate,
          updated_at = now();
    v_filled := v_filled || jsonb_build_object('item_price', true);
  else
    delete from public.purchase_request_item_prices where item_id = p_item_id;
  end if;

  select coalesce(i.component_id, public._canvass_item_component(i.id)) into v_component
    from public.purchase_request_items i where i.id = p_item_id;
  if v_component is null or public.get_employee_id() is null then
    return v_filled;
  end if;
  v_opp := public.canvass_component_opportunity(v_component);
  if v_opp is null or not public.costing_can_read(v_opp) then
    return v_filled;
  end if;

  select * into v_comp from public.costing_components where id = v_component for update;
  if not found then
    return v_filled;
  end if;
  select * into v_cost from public.costing_component_costs where component_id = v_component;

  -- Writes below are the caller's own (auth.uid() is still the caller), so the band triggers judge
  -- them; the flag only tells the mark-nulling trigger this is the fill.
  perform set_config('canvass.fill', 'on', true);

  if v_acquire is not null then
    if v_cost.acquire_from_offer_id is not null or v_cost.acquire_unit is null or v_cost.acquire_source = 'odoo' then
      perform public.costing_set_money(
        'costing_component_costs', v_component,
        jsonb_build_object('acquire_unit', v_acquire, 'acquire_from_offer_id', v_quote.id)
      );
      v_filled := v_filled || jsonb_build_object('acquire', true);
    end if;
  elsif v_cost.acquire_from_offer_id is not null then
    -- The figure came from an earlier winner and this one has none: keep the figure, drop the claim
    -- that the Canvass backs it.
    perform public.costing_set_money(
      'costing_component_costs', v_component,
      jsonb_build_object('acquire_from_offer_id', null)
    );
  end if;

  -- Offer Specification: the quote's description; documents: its brochure, cited.
  v_spec := nullif(btrim(coalesce(v_quote.description, '')), '') is not null
    and (v_comp.offer_specification_from_offer_id is not null
         or nullif(btrim(coalesce(v_comp.offer_specification, '')), '') is null);

  -- Documents that cite a quote are the Canvass's to replace; anything else is the user's.
  select coalesce(jsonb_agg(d), '[]'::jsonb) into v_kept
    from jsonb_array_elements(case when jsonb_typeof(v_comp.documents) = 'array' then v_comp.documents else '[]'::jsonb end) d
   where not (jsonb_typeof(d) = 'object' and d ? 'offer_id');
  v_docs := v_kept || coalesce((
    select jsonb_agg(b || jsonb_build_object('offer_id', v_quote.id))
      from jsonb_array_elements(case when jsonb_typeof(v_quote.brochure) = 'array' then v_quote.brochure else '[]'::jsonb end) b
  ), '[]'::jsonb);

  if v_spec then
    update public.costing_components
       set offer_specification = btrim(v_quote.description),
           offer_specification_from_offer_id = v_quote.id
     where id = v_component;
    v_filled := v_filled || jsonb_build_object('offer_specification', true);
  elsif v_comp.offer_specification_from_offer_id is not null
        and nullif(btrim(coalesce(v_quote.description, '')), '') is null then
    update public.costing_components
       set offer_specification_from_offer_id = null
     where id = v_component;
  end if;

  if v_docs is distinct from v_comp.documents then
    update public.costing_components set documents = v_docs where id = v_component;
    v_filled := v_filled || jsonb_build_object('documents', true);
  end if;

  perform set_config('canvass.fill', 'off', true);
  return v_filled;
end
$$;

create or replace function public.request_canvass_winners_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.supplier_id is distinct from old.supplier_id then
    perform public.canvass_fill_from_winner(new.item_id, new.supplier_id);
  end if;
  return null;
end
$$;

create trigger trg_request_canvass_winners_fill after insert or update on public.request_canvass_winners
  for each row execute function public.request_canvass_winners_fill();

-- "This supplier wins every line": picks the supplier on every line it quoted and skips the others
-- (and any line that is cancelled or locked). One reason for all of them.
create or replace function public.canvass_pick_supplier_for_all(p_canvass_id uuid, p_supplier_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_canvass public.request_canvasses;
  v_item    uuid;
  v_picked  integer := 0;
  v_skipped integer := 0;
begin
  if public.get_employee_id() is null then
    raise exception 'canvass_pick_supplier_for_all: sign in first' using errcode = '42501';
  end if;
  select * into v_canvass from public.request_canvasses where id = p_canvass_id;
  if not found then
    raise exception 'canvass_pick_supplier_for_all: not found' using errcode = 'P0002';
  end if;
  if not (public.canvass_can_write() and public.canvass_can_read(p_canvass_id)) then
    raise exception 'canvass_pick_supplier_for_all: not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.request_canvass_suppliers where id = p_supplier_id and canvass_id = p_canvass_id) then
    raise exception 'canvass_pick_supplier_for_all: that supplier is not on this Canvass' using errcode = 'P0002';
  end if;
  if v_reason = '' then
    raise exception 'A winner needs a reason.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('canvass_winner:' || p_canvass_id::text));

  for v_item in
    select q.item_id
      from public.request_canvass_quotes q
      join public.purchase_request_items i on i.id = q.item_id
     where q.canvass_id = p_canvass_id and q.supplier_id = p_supplier_id
     order by i.created_at, i.id
  loop
    if (select i.status from public.purchase_request_items i where i.id = v_item) = 'cancelled'
       or public.canvass_item_is_locked(v_item) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.request_canvass_winners (item_id, supplier_id, reason, chosen_by, chosen_at)
    values (v_item, p_supplier_id, v_reason, public.get_employee_id(), now())
    on conflict (item_id) do update
      set supplier_id = excluded.supplier_id, reason = excluded.reason,
          chosen_by = excluded.chosen_by, chosen_at = excluded.chosen_at;
    v_picked := v_picked + 1;
  end loop;

  return jsonb_build_object('canvass_id', p_canvass_id, 'supplier_id', p_supplier_id, 'picked', v_picked, 'skipped', v_skipped);
end
$$;

-- "Use the same reason for all": copies one reason to every picked line that isn't locked.
create or replace function public.canvass_use_same_reason(p_canvass_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_changed integer;
begin
  if public.get_employee_id() is null then
    raise exception 'canvass_use_same_reason: sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.request_canvasses where id = p_canvass_id) then
    raise exception 'canvass_use_same_reason: not found' using errcode = 'P0002';
  end if;
  if not (public.canvass_can_write() and public.canvass_can_read(p_canvass_id)) then
    raise exception 'canvass_use_same_reason: not allowed' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'A winner needs a reason.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('canvass_winner:' || p_canvass_id::text));

  update public.request_canvass_winners w
     set reason = v_reason
    from public.request_canvass_quotes q
   where q.canvass_id = p_canvass_id
     and q.supplier_id = w.supplier_id
     and q.item_id = w.item_id
     and not public.canvass_item_is_locked(w.item_id);
  get diagnostics v_changed = row_count;

  return jsonb_build_object('canvass_id', p_canvass_id, 'changed', v_changed);
end
$$;

grant execute on function public.canvass_pick_supplier_for_all(uuid, uuid, text) to authenticated;
grant execute on function public.canvass_use_same_reason(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Still canvassing
-- ---------------------------------------------------------------------------------------------

create or replace function public.request_canvass_quote_prices_mark_canvassing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.request_canvass_quotes;
  v_item  public.purchase_request_items;
  v_actor uuid;
begin
  if new.unit_price is null then
    return null;
  end if;
  select * into v_quote from public.request_canvass_quotes where id = new.quote_id;
  if not found then
    return null;
  end if;

  select * into v_item
    from public.purchase_request_items i
   where i.id = v_quote.item_id
     and i.status in ('not_checked', 'available', 'to_purchase', 'cannot_source')
     for update;
  if not found then
    return null;
  end if;

  v_actor := coalesce(public.get_employee_id(), v_quote.created_by);
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
  return null;
end
$$;

create trigger trg_request_canvass_quote_prices_mark_canvassing after insert or update of unit_price on public.request_canvass_quote_prices
  for each row execute function public.request_canvass_quote_prices_mark_canvassing();

-- ---------------------------------------------------------------------------------------------
-- 6. Canvasser defaults to the request's Purchasing Incharge
-- ---------------------------------------------------------------------------------------------

create or replace function public.request_canvasses_assign_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.number := 'CNV_' || lpad(nextval('public.sor_canvass_number_seq')::text, 4, '0');
  if public.get_employee_id() is not null then
    new.created_by := public.get_employee_id();
  end if;
  if new.canvasser_id is null then
    new.canvasser_id := coalesce(
      (select r.buyer_id from public.purchase_requests r where r.id = new.request_id),
      new.created_by
    );
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. Offer projection (#321), per quote
-- ---------------------------------------------------------------------------------------------

-- Per quote of the Canvass whose line names a Component: the Acquire in PHP and the Markup Price per
-- unit if it won. Served only for Components the caller reads at the Closed Book or Cost tier; null
-- when there is nothing to show. Reads only.
create or replace function public.canvass_offer_projection(p_canvass_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows   jsonb := '[]'::jsonb;
  v_q      record;
  v_factor numeric;
  v_acquire numeric;
begin
  if not coalesce(public.canvass_can_read(p_canvass_id), false) then
    return null;
  end if;

  for v_q in
    select qu.id as quote_id, qu.supplier_id, qu.item_id, comp.component_id,
           s.currency, p.unit_price, sp.comparison_rate
      from public.request_canvass_quotes qu
      join public.purchase_request_items i on i.id = qu.item_id
      cross join lateral (select coalesce(i.component_id, public._canvass_item_component(i.id)) as component_id) comp
      join public.request_canvass_suppliers s on s.id = qu.supplier_id
      left join public.request_canvass_quote_prices p on p.quote_id = qu.id
      left join public.request_canvass_supplier_prices sp on sp.supplier_id = s.id
     where qu.canvass_id = p_canvass_id and comp.component_id is not null
     order by s.sort_order, qu.created_at, qu.id
  loop
    if coalesce(public.costing_tier(public.canvass_component_opportunity(v_q.component_id)), '') not in ('closed_book', 'cost') then
      continue;
    end if;
    select k.markup_factor into v_factor from public.costing_component_costs k where k.component_id = v_q.component_id;
    v_acquire := case
      when v_q.unit_price is null then null
      when v_q.currency = 'PHP' then round(v_q.unit_price, 2)
      when v_q.comparison_rate is null then null
      else round(v_q.unit_price * v_q.comparison_rate, 2)
    end;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'offer_id', v_q.quote_id,
      'quote_id', v_q.quote_id,
      'item_id', v_q.item_id,
      'supplier_id', v_q.supplier_id,
      'acquire_unit', v_acquire,
      'markup_price_unit', public.costing_component_markup_price(v_q.component_id, v_acquire, v_factor)
    ));
  end loop;

  if jsonb_array_length(v_rows) = 0 then
    return null;
  end if;
  return v_rows;
end
$$;

grant execute on function public.canvass_offer_projection(uuid) to authenticated;
