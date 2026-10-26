-- ==============================================================================
-- 20261104130000_requested_item_follows_s0.sql
--
-- #678 (spec #675): the project request lists every S0 line ("From the S0").
--
-- BEFORE: a Requested Item was a copy picked from an SOR line by hand, then
-- compared with the line ("SOR changed") and followed or kept on request.
--
-- NOW: every S0 line has exactly one Requested Item on the SOR's Purchase
-- Request, created by itself and kept in step with the line (name, quantity,
-- unit, Odoo product) whenever the line is written -- which `sor_replace_items`
-- does only when the S0 really changed. The item starts at Not checked.
--   * The database refuses a second item for the same SOR line (unique index).
--   * A line the S0 dropped keeps its item; `removed_from_s0` says so.
--   * An item with no SOR line is an Other request.
--   * The old flows are retired: pick a line into the request, "Update to the
--     SOR" and "Keep as asked".
--
-- Items are made by two triggers: one when a project request is opened (every
-- line already on the SOR), one when a line is added or changed. Neither
-- touches an item's status, history, chat, P0 or Canvass.
--
-- Safe to run against a live frontend of any version: one new defaulted column,
-- new functions and triggers, and four retired functions.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Columns and the uniqueness rule
-- ------------------------------------------------------------------------------

alter table public.purchase_request_items
  add column if not exists removed_from_s0 boolean not null default false;

comment on column public.purchase_request_items.removed_from_s0 is
  'True when the item''s SOR line was dropped from the S0. The item stays (a purchase may hang off it) and the screen says "Removed from S0". #678.';

-- Older data could hold two items on one SOR line (picked twice). The oldest keeps
-- the line; the others become Other requests. Nothing is deleted.
update public.purchase_request_items i
set sor_item_id = null
where i.sor_item_id is not null
  and i.id <> (
    select x.id from public.purchase_request_items x
    where x.sor_item_id = i.sor_item_id
    order by x.created_at, x.id
    limit 1
  );

create unique index if not exists purchase_request_items_sor_item_uidx
  on public.purchase_request_items (sor_item_id)
  where sor_item_id is not null;

comment on column public.purchase_request_items.sor_item_id is
  'The SOR product line this item is for, by the line''s fixed id (#677). One item per line (#678). Null = an Other request.';

-- ------------------------------------------------------------------------------
-- Retire the old flows
-- ------------------------------------------------------------------------------

drop function if exists public.purchase_request_update_item_from_sor(uuid, text);
drop function if exists public.purchase_request_keep_item_as_asked(uuid);
drop function if exists public.purchase_request_add_item_from_line(uuid, uuid);
drop function if exists public.purchase_request_pickable_lines(uuid);
drop function if exists public._purchase_request_item_sor_line(public.purchase_request_items);

alter table public.purchase_request_items drop column if exists sor_change_seen;

-- ------------------------------------------------------------------------------
-- The sync: one item per S0 line
-- ------------------------------------------------------------------------------

-- Creates the item for a line, or brings the existing one in step. Does nothing
-- when the line's SOR has no request. Status, PO, chat and Canvass are never touched.
create or replace function public._purchase_request_sync_sor_line(p_line public.sales_opportunity_items)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req    public.purchase_requests;
  v_name   text := btrim(p_line.product_name);
  v_unit   text := nullif(btrim(p_line.unit), '');
begin
  if v_name is null or v_name = '' then
    return;
  end if;

  select * into v_req from public.purchase_requests where opportunity_id = p_line.opportunity_id;
  if v_req.id is null then
    return;
  end if;

  insert into public.purchase_request_items
    (request_id, source, odoo_product_id, sor_item_id, name, unit, quantity, sor_line_snapshot,
     removed_from_s0, requested_by)
  values
    (v_req.id, 'sor_line', p_line.odoo_product_id, p_line.id, v_name, v_unit,
     case when coalesce(p_line.quantity, 0) > 0 then p_line.quantity else 1 end,
     jsonb_build_object('name', v_name, 'quantity', p_line.quantity, 'unit', v_unit),
     p_line.removed_from_s0, v_req.created_by)
  on conflict (sor_item_id) where sor_item_id is not null do update
  set odoo_product_id = excluded.odoo_product_id,
      name = excluded.name,
      unit = excluded.unit,
      -- A line with no quantity leaves the item's quantity as it was.
      quantity = case when coalesce(p_line.quantity, 0) > 0 then p_line.quantity else purchase_request_items.quantity end,
      sor_line_snapshot = excluded.sor_line_snapshot,
      removed_from_s0 = excluded.removed_from_s0
  where (purchase_request_items.odoo_product_id, purchase_request_items.name, purchase_request_items.unit,
         purchase_request_items.quantity, purchase_request_items.removed_from_s0)
        is distinct from
        (excluded.odoo_product_id, excluded.name, excluded.unit,
         case when coalesce(p_line.quantity, 0) > 0 then p_line.quantity else purchase_request_items.quantity end,
         excluded.removed_from_s0);
end;
$$;

revoke all on function public._purchase_request_sync_sor_line(public.sales_opportunity_items) from public, anon, authenticated;

-- Every line of the request's SOR. A Direct request has no SOR and gets nothing.
create or replace function public._purchase_request_sync_sor_items(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.sales_opportunity_items;
begin
  for v_line in
    select l.*
    from public.purchase_requests r
    join public.sales_opportunity_items l on l.opportunity_id = r.opportunity_id
    where r.id = p_request_id
    order by l.sort_order, l.created_at, l.id
  loop
    perform public._purchase_request_sync_sor_line(v_line);
  end loop;
end;
$$;

revoke all on function public._purchase_request_sync_sor_items(uuid) from public, anon, authenticated;

-- A project request opened: every line already on the SOR becomes an item.
create or replace function public.trg_purchase_request_sync_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.opportunity_id is not null then
    perform public._purchase_request_sync_sor_items(new.id);
  end if;
  return null;
end;
$$;

revoke all on function public.trg_purchase_request_sync_items() from public, anon, authenticated;

drop trigger if exists trg_purchase_requests_sync_items on public.purchase_requests;
create trigger trg_purchase_requests_sync_items
  after insert on public.purchase_requests
  for each row execute function public.trg_purchase_request_sync_items();

-- A line added or changed on the SOR: its item follows.
create or replace function public.trg_sor_line_sync_request_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._purchase_request_sync_sor_line(new);
  return null;
end;
$$;

revoke all on function public.trg_sor_line_sync_request_item() from public, anon, authenticated;

drop trigger if exists trg_sor_line_sync_request_item on public.sales_opportunity_items;
create trigger trg_sor_line_sync_request_item
  after insert or update on public.sales_opportunity_items
  for each row execute function public.trg_sor_line_sync_request_item();

-- ------------------------------------------------------------------------------
-- One-time backfill: requests that already exist get an item for every line
-- ------------------------------------------------------------------------------

do $$
declare
  v_id uuid;
begin
  for v_id in select r.id from public.purchase_requests r where r.opportunity_id is not null loop
    perform public._purchase_request_sync_sor_items(v_id);
  end loop;
end $$;
