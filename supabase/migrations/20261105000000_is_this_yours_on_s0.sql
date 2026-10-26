-- 20261105000000_is_this_yours_on_s0.sql
--
-- #688 (spec #675): "Is this from your purchase request?" When Sales adds to the S0 a product that
-- was already bought as an Other request, it must not show twice.
--
--   * A new S0 line's item is checked once, when it is made: if an Other request on the same
--     project has a P0 attached for the same Odoo product, the S0 line is marked `new_on_s0` and
--     points at that request (`yours_item_id`). The screen shows "Is this yours?".
--   * The same question is asked when the P0 is attached to the Other request AFTER the S0 line
--     already exists: the Other request getting a bought product that matches an S0 line (same
--     Odoo product, no P0 yet) marks that S0 line the same way.
--   * `purchase_request_answer_yours(item, same)`:
--       same = false  clears the question and changes nothing else.
--       same = true   moves the P0, its delivery, status, history, Canvass and price onto the S0
--                     line and closes the Other request as Cancelled with
--                     "Closed · {P0} and its delivery moved onto {S0 line}". Nothing is deleted,
--                     all in this one call.
--   * `bought_product_id` is the Odoo product on the attached P0 line. The odoo-po-verify edge
--     function writes it beside `bought_as` when a P0 is attached.
--
-- Additive columns; idempotent.

alter table public.purchase_request_items
  add column if not exists bought_product_id integer,
  add column if not exists new_on_s0 boolean not null default false,
  add column if not exists yours_item_id uuid references public.purchase_request_items (id) on delete set null,
  add column if not exists closed_note text;

comment on column public.purchase_request_items.bought_product_id is
  '#688: the Odoo product id on the attached P0 line (the id behind bought_as). Used to tell when a new S0 line is the same product.';
comment on column public.purchase_request_items.new_on_s0 is
  '#688: true while an S0 line waits for an answer to "Is this from your purchase request?". Holds the line open in the folded list.';
comment on column public.purchase_request_items.yours_item_id is
  '#688: the Other request the S0 line may be the same product as. Set with new_on_s0.';
comment on column public.purchase_request_items.closed_note is
  '#688: why an item was closed by the app, in the words the screen shows (for example "Closed · P01234 and its delivery moved onto Harness").';

-- The question is asked once, when an S0 line's item is made.
create or replace function public.trg_purchase_request_item_ask_yours()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other uuid;
begin
  if new.sor_item_id is null or new.odoo_product_id is null then
    return null;
  end if;

  select o.id into v_other
    from public.purchase_request_items o
   where o.request_id = new.request_id
     and o.sor_item_id is null
     and o.purpose = 'client'
     and o.po_number is not null
     and o.status <> 'cancelled'
     and o.bought_product_id = new.odoo_product_id
   order by o.created_at, o.id
   limit 1;

  if v_other is not null then
    update public.purchase_request_items
       set new_on_s0 = true, yours_item_id = v_other
     where id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function public.trg_purchase_request_item_ask_yours() from public, anon, authenticated;

drop trigger if exists trg_purchase_request_item_ask_yours on public.purchase_request_items;
create trigger trg_purchase_request_item_ask_yours
  after insert on public.purchase_request_items
  for each row execute function public.trg_purchase_request_item_ask_yours();

-- The other order: a P0 is attached to an Other request when the matching S0 line is already there.
-- Fires when the bought product (or P0) on the Other request changes, so a "No" is not asked again.
create or replace function public.trg_purchase_request_item_ask_yours_on_p0()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s0 uuid;
begin
  if new.sor_item_id is not null
     or new.purpose is distinct from 'client'
     or new.po_number is null
     or new.status = 'cancelled'
     or new.bought_product_id is null then
    return null;
  end if;

  select s.id into v_s0
    from public.purchase_request_items s
   where s.request_id = new.request_id
     and s.sor_item_id is not null
     and s.odoo_product_id = new.bought_product_id
     and s.po_number is null
     and s.status <> 'cancelled'
     and s.new_on_s0 = false
   order by s.created_at, s.id
   limit 1;

  if v_s0 is not null then
    update public.purchase_request_items
       set new_on_s0 = true, yours_item_id = new.id
     where id = v_s0;
  end if;
  return null;
end;
$$;

revoke all on function public.trg_purchase_request_item_ask_yours_on_p0() from public, anon, authenticated;

drop trigger if exists trg_purchase_request_item_ask_yours_on_p0 on public.purchase_request_items;
create trigger trg_purchase_request_item_ask_yours_on_p0
  after update of po_number, bought_product_id on public.purchase_request_items
  for each row
  when (new.bought_product_id is not null
        and (old.po_number is distinct from new.po_number or old.bought_product_id is distinct from new.bought_product_id))
  execute function public.trg_purchase_request_item_ask_yours_on_p0();

-- The answer. Returns the S0 line's item.
create or replace function public.purchase_request_answer_yours(p_item_id uuid, p_same boolean)
returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_s0 public.purchase_request_items;
  v_other public.purchase_request_items;
  v_po text;
begin
  if v_actor is null then
    raise exception 'purchase_request_answer_yours: not signed in' using errcode = '42501';
  end if;
  if p_same is null then
    raise exception 'purchase_request_answer_yours: answer yes or no' using errcode = '22023';
  end if;

  select * into v_s0 from public.purchase_request_items where id = p_item_id for update;
  if v_s0.id is null then
    raise exception 'purchase_request_answer_yours: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if coalesce(public.purchase_request_actor_side(v_s0.request_id), '') not in ('purchasing', 'sales') then
    raise exception 'purchase_request_answer_yours: only Purchasing or the sales side answers this' using errcode = '42501';
  end if;
  if not v_s0.new_on_s0 then
    raise exception 'purchase_request_answer_yours: % has no open question', v_s0.name using errcode = '22023';
  end if;

  if not p_same then
    update public.purchase_request_items
       set new_on_s0 = false, yours_item_id = null
     where id = v_s0.id
    returning * into v_s0;
    return v_s0;
  end if;

  select * into v_other from public.purchase_request_items where id = v_s0.yours_item_id for update;
  if v_other.id is null or v_other.status = 'cancelled' or v_other.po_number is null then
    raise exception 'purchase_request_answer_yours: the request this was compared with has changed; answer No, or refresh' using errcode = '22023';
  end if;
  if v_s0.po_number is not null then
    raise exception 'purchase_request_answer_yours: % already has a P0', v_s0.name using errcode = '22023';
  end if;
  v_po := v_other.po_number;

  -- The Other request lets go of the P0 first (a P0 sits on one line).
  update public.purchase_request_items
     set status = 'cancelled',
         status_changed_by = v_actor,
         status_changed_at = now(),
         po_number = null,
         po_verification = 'UNVERIFIED',
         po_state = null,
         po_ordered = null,
         po_received = null,
         bought_as = null,
         bought_product_id = null,
         odoo_po_line_ids = '{}',
         closed_note = format('Closed · %s and its delivery moved onto %s', v_po, v_s0.name)
   where id = v_other.id;

  update public.purchase_request_items
     set status = v_other.status,
         status_changed_by = v_actor,
         status_changed_at = now(),
         po_number = v_other.po_number,
         po_verification = v_other.po_verification,
         po_state = v_other.po_state,
         po_ordered = v_other.po_ordered,
         po_received = v_other.po_received,
         bought_as = v_other.bought_as,
         bought_product_id = v_other.bought_product_id,
         odoo_po_line_ids = v_other.odoo_po_line_ids,
         new_on_s0 = false,
         yours_item_id = null
   where id = v_s0.id
  returning * into v_s0;

  -- History, Canvass, price and the links other items hold follow the P0 onto the S0 line.
  update public.purchase_request_messages
     set metadata = metadata || jsonb_build_object('item_id', v_s0.id)
   where request_id = v_s0.request_id and metadata->>'item_id' = v_other.id::text;

  update public.sor_canvasses set requested_item_id = v_s0.id
   where requested_item_id = v_other.id
     and not exists (select 1 from public.sor_canvasses c where c.requested_item_id = v_s0.id);

  update public.purchase_request_item_prices set item_id = v_s0.id
   where item_id = v_other.id
     and not exists (select 1 from public.purchase_request_item_prices p where p.item_id = v_s0.id);

  update public.purchase_request_items set substitute_for_item_id = v_s0.id
   where substitute_for_item_id = v_other.id and id <> v_s0.id;

  perform public._purchase_request_post_event(
    v_s0.request_id,
    v_actor,
    format('%s: same product as the request for %s. %s and its delivery moved onto the S0 line; the request is closed.', v_s0.name, v_other.name, v_po),
    jsonb_build_object(
      'event', 'item_yours_merged',
      'item_id', v_s0.id,
      'closed_item_id', v_other.id,
      'po_number', v_po
    )
  );

  return v_s0;
end;
$$;

comment on function public.purchase_request_answer_yours(uuid, boolean) is
  '#688: answers "Is this from your purchase request?" on an S0 line. No clears the question only. Yes moves the P0, status, history, Canvass and price onto the S0 line and closes the Other request as Cancelled, in one call. Purchasing and the sales side only.';

revoke all on function public.purchase_request_answer_yours(uuid, boolean) from public, anon;
grant execute on function public.purchase_request_answer_yours(uuid, boolean) to authenticated;
