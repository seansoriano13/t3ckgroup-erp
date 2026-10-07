-- ==============================================================================
-- 20261007161200_purchase_request_item_po.sql
--
-- Issue #312 (part of #209) — the PO number and the Odoo PO line on Ordered.
--
-- ORDERED TAKES AN OPTIONAL PO NUMBER
--   `pr_set_item_status(item, 'ordered', details)` now accepts
--   `details = { po_number, po_verification }`. Both are optional; an item can
--   be Ordered with no PO number. The client checks the number against Odoo
--   first (`odoo-po-verify`, the same trust as the legacy purchasing panel)
--   and passes the result; the PO number is normalised (trimmed, upper-cased)
--   and must look like an Odoo purchase order ("P" then digits). Any other
--   status still takes no details, and Ordered takes no other key.
--
--   REDEFINES `pr_set_item_status` from 20261007130600 (#306). Same signature,
--   same checks; only the details rule changes.
--
-- THE PO LINE, FROM THE PO'S IPAS
--   With a PO number, Ordered also records the Odoo PO line or lines the item
--   is bought on (`odoo_po_line_ids`), picked from that PO's IPAS stored Odoo
--   copy. A line is never guessed: `pr_pick_po_lines` refuses any line that
--   isn't on that copy, and an Ordered item with a PO but no lines reads
--   "PO line not picked" until Purchasing picks them.
--
--   No IPAS exists in the ERP yet (map #210; #228 decides how a Requested
--   Item's PO number finds its IPAS). `_ipas_po_line_ids` is the seam: it
--   answers '{}' for every PO today, so every pick is refused and the picker
--   stays hidden. When IPAS lands, replace its body — nothing else changes.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: new
-- functions plus one `create or replace` whose old calls behave the same
-- (empty details). Idempotent.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- The seam: a PO's lines on its IPAS stored Odoo copy
-- ------------------------------------------------------------------------------

-- TODO(#210, #228): IPAS isn't built yet. Once it stores its Odoo PO copy,
-- return that copy's purchase.order.line ids for `p_po_number` here.
create or replace function public._ipas_po_line_ids(p_po_number text)
returns int[]
language sql
stable
set search_path = public
as $$
  select '{}'::int[];
$$;

comment on function public._ipas_po_line_ids(text) is
  '#312 seam: the Odoo purchase.order.line ids on the IPAS stored Odoo copy of PO `p_po_number`. Empty until IPAS exists (#210, #228), so no PO line can be picked yet.';

revoke all on function public._ipas_po_line_ids(text) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Ordered takes a PO number (redefines #306's pr_set_item_status)
-- ------------------------------------------------------------------------------

create or replace function public.pr_set_item_status(
  p_item_id uuid,
  p_status text,
  p_details jsonb default '{}'::jsonb
) returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_item public.purchase_request_items;
  v_side text;
  v_key text;
  v_po text;
  v_verification text;
begin
  if v_actor is null then
    raise exception 'pr_set_item_status: not signed in' using errcode = '42501';
  end if;
  if p_status is null or p_status not in (
    'requested', 'from_stock', 'to_order', 'canvassing', 'ordered', 'received',
    'substituted', 'cannot_source', 'cancelled'
  ) then
    raise exception 'pr_set_item_status: % is not an item status', coalesce(p_status, 'null') using errcode = '22023';
  end if;
  if jsonb_typeof(v_details) <> 'object' then
    raise exception 'pr_set_item_status: details must be an object' using errcode = '22023';
  end if;

  -- Only Ordered takes details: its PO number and what Odoo said about it.
  if p_status <> 'ordered' and v_details <> '{}'::jsonb then
    raise exception 'pr_set_item_status: % takes no details', public._purchase_request_item_status_label(p_status)
      using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(v_details) loop
    if v_key not in ('po_number', 'po_verification') then
      raise exception 'pr_set_item_status: Ordered takes a PO number and its check, not %', v_key
        using errcode = '22023';
    end if;
  end loop;

  if v_details ? 'po_number' and jsonb_typeof(v_details->'po_number') not in ('string', 'null') then
    raise exception 'pr_set_item_status: the PO number must be text' using errcode = '22023';
  end if;
  v_po := nullif(upper(btrim(v_details->>'po_number')), '');
  v_verification := nullif(btrim(v_details->>'po_verification'), '');
  if v_po is not null and v_po !~ '^P[0-9]+$' then
    raise exception 'pr_set_item_status: % isn''t an Odoo PO number ("P" then digits, e.g. P01234)', v_po
      using errcode = '22023';
  end if;
  if v_verification is not null and v_po is null then
    raise exception 'pr_set_item_status: a PO check needs a PO number' using errcode = '22023';
  end if;
  if v_verification is not null
     and v_verification not in ('UNVERIFIED', 'VERIFIED', 'PENDING_VERIFICATION', 'NOT_FOUND') then
    raise exception 'pr_set_item_status: % is not a PO check result', v_verification using errcode = '22023';
  end if;
  if v_po is not null then
    v_verification := coalesce(v_verification, 'UNVERIFIED');
    v_details := jsonb_build_object('po_number', v_po, 'po_verification', v_verification);
  else
    v_details := '{}'::jsonb;
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'pr_set_item_status: item % not found', p_item_id using errcode = 'P0002';
  end if;

  v_side := public.pr_actor_side(v_item.request_id);
  if v_side is null then
    raise exception 'pr_set_item_status: only the request''s members may change an item' using errcode = '42501';
  end if;

  v_item := public._purchase_request_item_move(v_item, p_status, v_side, v_actor, v_details, 'pr_set_item_status');

  if v_po is not null then
    update public.purchase_request_items
       set po_number = v_po,
           po_verification = v_verification
     where id = v_item.id
    returning * into v_item;
  end if;

  return v_item;
end;
$$;

comment on function public.pr_set_item_status(uuid, text, jsonb) is
  '#306/#312: moves a Requested Item along its status path. Checks the transition and the caller''s side (purchasing walks the path; the sales side may only cancel), records who and when, and posts the change in the request. Ordered alone takes details: an optional `po_number` (P + digits) and its Odoo check `po_verification`, stored on the item.';

-- ------------------------------------------------------------------------------
-- Picking the PO line
-- ------------------------------------------------------------------------------

-- The lines an item's PO has on its IPAS stored Odoo copy, for the picker.
-- Empty when the item has no PO number, or its PO has no IPAS yet.
create or replace function public.pr_item_po_lines(p_item_id uuid)
returns int[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item public.purchase_request_items;
begin
  if public.get_employee_id() is null then
    raise exception 'pr_item_po_lines: not signed in' using errcode = '42501';
  end if;
  select * into v_item from public.purchase_request_items where id = p_item_id;
  if v_item.id is null or not public.can_read_purchase_request(v_item.request_id) then
    raise exception 'pr_item_po_lines: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if v_item.po_number is null then
    return '{}'::int[];
  end if;
  return coalesce(public._ipas_po_line_ids(v_item.po_number), '{}'::int[]);
end;
$$;

comment on function public.pr_item_po_lines(uuid) is
  '#312: the Odoo PO line ids on the IPAS stored Odoo copy of an item''s PO — what the line picker offers. Empty with no PO number, or while the PO has no IPAS.';

-- Records which lines of its PO an Ordered (or Received) item is bought on.
-- Refuses any line that isn't on the PO's IPAS stored Odoo copy; a PO with no
-- IPAS yet refuses every line. Picking again replaces the earlier pick.
create or replace function public.pr_pick_po_lines(p_item_id uuid, p_line_ids int[])
returns public.purchase_request_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_item public.purchase_request_items;
  v_lines int[];
  v_ipas int[];
  v_stray int[];
begin
  if v_actor is null then
    raise exception 'pr_pick_po_lines: not signed in' using errcode = '42501';
  end if;

  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'pr_pick_po_lines: item % not found', p_item_id using errcode = 'P0002';
  end if;
  if coalesce(public.pr_actor_side(v_item.request_id), '') <> 'purchasing' then
    raise exception 'pr_pick_po_lines: only Purchasing picks an item''s PO line' using errcode = '42501';
  end if;
  if v_item.status not in ('ordered', 'received') then
    raise exception 'pr_pick_po_lines: % is %, not Ordered', v_item.name,
      public._purchase_request_item_status_label(v_item.status)
      using errcode = '22023';
  end if;
  if v_item.po_number is null then
    raise exception 'pr_pick_po_lines: % has no PO number', v_item.name using errcode = '22023';
  end if;

  if p_line_ids is null or cardinality(p_line_ids) = 0 or array_position(p_line_ids, null) is not null then
    raise exception 'pr_pick_po_lines: pick at least one PO line' using errcode = '22023';
  end if;
  select array_agg(distinct l order by l) into v_lines from unnest(p_line_ids) l;

  v_ipas := coalesce(public._ipas_po_line_ids(v_item.po_number), '{}'::int[]);
  if cardinality(v_ipas) = 0 then
    raise exception 'pr_pick_po_lines: PO % has no IPAS yet; pick its line once it does', v_item.po_number
      using errcode = '22023';
  end if;
  select array_agg(l order by l) into v_stray from unnest(v_lines) l where not (l = any (v_ipas));
  if v_stray is not null then
    raise exception 'pr_pick_po_lines: line % isn''t on PO %''s IPAS copy', array_to_string(v_stray, ', '), v_item.po_number
      using errcode = '22023';
  end if;

  update public.purchase_request_items
     set odoo_po_line_ids = v_lines
   where id = v_item.id
  returning * into v_item;

  perform public._purchase_request_post_event(
    v_item.request_id,
    v_actor,
    format('%s: PO line picked on %s.', v_item.name, v_item.po_number),
    jsonb_build_object(
      'event', 'item_po_lines_picked',
      'item_id', v_item.id,
      'po_number', v_item.po_number,
      'line_ids', to_jsonb(v_lines)
    )
  );

  return v_item;
end;
$$;

comment on function public.pr_pick_po_lines(uuid, int[]) is
  '#312: Purchasing records the Odoo PO line(s) an Ordered item is bought on. Refuses any line not on the IPAS stored Odoo copy of the item''s PO (all of them while that PO has no IPAS); posts the pick in the request.';

-- ------------------------------------------------------------------------------
-- Grants: signed-in callers only
-- ------------------------------------------------------------------------------

revoke all on function public.pr_set_item_status(uuid, text, jsonb) from public, anon;
revoke all on function public.pr_item_po_lines(uuid) from public, anon;
revoke all on function public.pr_pick_po_lines(uuid, int[]) from public, anon;

grant execute on function public.pr_set_item_status(uuid, text, jsonb) to authenticated;
grant execute on function public.pr_item_po_lines(uuid) to authenticated;
grant execute on function public.pr_pick_po_lines(uuid, int[]) to authenticated;
