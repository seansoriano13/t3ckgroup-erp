-- ==============================================================================
-- 20261104200000_replace_a_product.sql
--
-- #687 (spec #675): Replace a product with another.
--
-- Purchasing records a technical swap without losing the original ask. There is
-- no Substituted status; Replace reuses the "substitute for" link between items.
--
-- purchase_request_replace_item(A, B's name, reason) does it in ONE call:
--   * A becomes Cancelled, with the reason kept on the row ("Replaced by B -- reason");
--   * A's open Canvass (not signed off, not already stopped) is closed as
--     "Stopped · replaced by B". Its Offers, winner and reason are never touched;
--   * B becomes its own item in Other requests: same quantity and unit, Not checked,
--     linked to A by substitute_for_item_id;
--   * when A was an S0 line, A carries s0_still_lists and the request chat tells Sales
--     to update the S0. Nobody wins automatically; the flag stays until the S0 drops
--     the line (removed_from_s0), so the mismatch stays visible. Purchasing is never blocked.
--
-- Only Purchasing (Super Admin, or a member with Purchasing access) may Replace.
-- A reason is required. Replace is off on Cancelled and Received lines.
-- ==============================================================================

alter table public.purchase_request_items
  add column if not exists replaced_reason text,
  add column if not exists s0_still_lists boolean not null default false;

comment on column public.purchase_request_items.replaced_reason is
  '#687: why Purchasing replaced this item. Set with the item''s move to Cancelled by purchase_request_replace_item; the replacement is the item whose substitute_for_item_id is this item.';
comment on column public.purchase_request_items.s0_still_lists is
  '#687: this was an S0 line and it was replaced, but the S0 still lists it. Sales updates the S0. Cleared when the S0 drops the line.';

-- The mismatch ends when the S0 drops the line.
create or replace function public.trg_purchase_request_items_clear_s0_still_lists()
returns trigger
language plpgsql
as $$
begin
  if new.removed_from_s0 and new.s0_still_lists then
    new.s0_still_lists := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_purchase_request_items_clear_s0_still_lists on public.purchase_request_items;
create trigger trg_purchase_request_items_clear_s0_still_lists
  before update of removed_from_s0 on public.purchase_request_items
  for each row execute function public.trg_purchase_request_items_clear_s0_still_lists();

alter table public.sor_canvasses
  add column if not exists stopped_at timestamptz,
  add column if not exists stopped_by uuid references public.employees (id),
  add column if not exists stopped_reason text;

comment on column public.sor_canvasses.stopped_at is
  '#687: set when the Canvass was closed without a sign-off because its product line was replaced. stopped_reason holds "Stopped · replaced by B".';

create or replace function public.purchase_request_replace_item(
  p_item_id uuid,
  p_name text,
  p_reason text,
  p_odoo_product_id integer default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := public.get_employee_id();
  v_name     text := nullif(btrim(p_name), '');
  v_reason   text := nullif(btrim(p_reason), '');
  v_old      public.purchase_request_items;
  v_new      public.purchase_request_items;
  v_still    boolean;
  v_amount   text;
  v_stopped  integer;
begin
  if v_actor is null then
    raise exception 'purchase_request_replace_item: not signed in' using errcode = '42501';
  end if;

  select * into v_old from public.purchase_request_items where id = p_item_id for update;
  if v_old.id is null then
    raise exception 'purchase_request_replace_item: item % not found', p_item_id using errcode = 'P0002';
  end if;

  if public.purchase_request_actor_side(v_old.request_id) is distinct from 'purchasing' then
    raise exception 'purchase_request_replace_item: only Purchasing can replace a product' using errcode = '42501';
  end if;
  if v_old.status in ('cancelled', 'received') then
    raise exception 'purchase_request_replace_item: % is already %, so it can''t be replaced',
      v_old.name, public._purchase_request_item_status_label(v_old.status) using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'purchase_request_replace_item: say which product replaces it' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'purchase_request_replace_item: give a short reason for the replacement' using errcode = '22023';
  end if;

  -- B: its own line in Other requests, same quantity, Not checked.
  insert into public.purchase_request_items
    (request_id, source, odoo_product_id, name, unit, quantity, substitute_for_item_id, requested_by)
  values
    (v_old.request_id, 'new', p_odoo_product_id, v_name, v_old.unit, v_old.quantity, v_old.id, v_actor)
  returning * into v_new;

  v_still := v_old.sor_item_id is not null and not v_old.removed_from_s0;

  -- A: Cancelled, with the reason.
  update public.purchase_request_items
     set status = 'cancelled',
         status_changed_by = v_actor,
         status_changed_at = now(),
         replaced_reason = v_reason,
         s0_still_lists = v_still
   where id = v_old.id
  returning * into v_old;

  -- A's open Canvass stops. A signed-off Canvass is a finished record and stays as it is.
  update public.sor_canvasses
     set stopped_at = now(),
         stopped_by = v_actor,
         stopped_reason = 'Stopped · replaced by ' || v_name
   where requested_item_id = v_old.id
     and signed_off_at is null
     and stopped_at is null;
  get diagnostics v_stopped = row_count;

  v_amount := trim_scale(v_new.quantity)::text || coalesce(' ' || v_new.unit, '');
  perform public._purchase_request_post_event(
    v_old.request_id,
    v_actor,
    format('%s replaced by %s × %s — %s.', v_old.name, v_new.name, v_amount, v_reason),
    jsonb_build_object(
      'event', 'item_replaced',
      'item_id', v_old.id,
      'replacement_item_id', v_new.id,
      'reason', v_reason,
      'canvass_stopped', v_stopped > 0,
      's0_still_lists', v_still
    )
  );
  if v_still then
    perform public._purchase_request_post_event(
      v_old.request_id,
      v_actor,
      format('S0 still lists %s. Sales to update the S0.', v_old.name),
      jsonb_build_object('event', 's0_still_lists', 'item_id', v_old.id, 'replacement_item_id', v_new.id)
    );
  end if;

  return v_new.id;
end;
$$;

comment on function public.purchase_request_replace_item(uuid, text, text, integer) is
  '#687: Purchasing replaces product A with B. A becomes Cancelled with the reason, A''s open Canvass stops, B is a new Other request (same quantity, Not checked) linked by substitute_for_item_id; an S0 line is flagged s0_still_lists and Sales is told in the chat. Refused for a non-Purchasing caller, a missing reason, and a Cancelled or Received item.';

revoke all on function public.purchase_request_replace_item(uuid, text, text, integer) from public, anon;
grant execute on function public.purchase_request_replace_item(uuid, text, text, integer) to authenticated;
