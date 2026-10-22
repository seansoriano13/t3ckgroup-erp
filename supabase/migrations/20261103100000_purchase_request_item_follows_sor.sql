-- ==============================================================================
-- 20261103100000_purchase_request_item_follows_sor.sql
--
-- A Requested Item picked from an SOR line is a snapshot (#305). When the SOR
-- later says something else, the item only warned. Now the people on the
-- request can act on the warning.
--
-- UPDATE TO THE SOR
-- `purchase_request_update_item_from_sor` copies the SOR line's quantity and
-- unit into the item and its snapshot, and posts what changed in the request.
-- Whoever may add items may do it. Once the item is Ordered the PO is a fact,
-- so a reason is required, and it is posted with the change. A closed item
-- (From stock, Received, Substituted, Cannot source, Cancelled) is never
-- rewritten. A line the SOR no longer has cannot be followed.
--
-- The line is found the way `purchase_request_item_lines` finds it: by Odoo
-- product, else by name. SOR lines are deleted and re-inserted on every save
-- and carry no Odoo line id, so there is no exact line to link to.
--
-- KEEP AS ASKED
-- `purchase_request_keep_item_as_asked` records the SOR line the item was
-- judged against in `sor_change_seen`. The flag stays quiet until the SOR says
-- something other than that.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: one new
-- nullable column and new functions only. Idempotent.
-- ==============================================================================

alter table public.purchase_request_items
  add column if not exists sor_change_seen jsonb;

comment on column public.purchase_request_items.sor_change_seen is
  '{ quantity, unit } of the SOR line when someone chose "Keep as asked". The "SOR changed" flag stays quiet while the SOR still says this; null when nobody has.';

-- ------------------------------------------------------------------------------
-- The item's SOR line as it stands now (the one purchase_request_item_lines finds)
-- ------------------------------------------------------------------------------

create or replace function public._purchase_request_item_sor_line(p_item public.purchase_request_items)
returns public.sales_opportunity_items
language sql
stable
security definer
set search_path = public
as $$
  select sl.*
  from purchase_requests r
  join sales_opportunity_items sl on sl.opportunity_id = r.opportunity_id
  where r.id = p_item.request_id
    and case
      when p_item.odoo_product_id is not null then sl.odoo_product_id = p_item.odoo_product_id
      else lower(btrim(sl.product_name)) = lower(btrim(p_item.sor_line_snapshot->>'name'))
    end
  order by (sl.quantity = (p_item.sor_line_snapshot->>'quantity')::numeric) desc, sl.sort_order, sl.created_at
  limit 1;
$$;

revoke all on function public._purchase_request_item_sor_line(public.purchase_request_items) from public, anon, authenticated;

-- "2 pc", "2.5 m", "3"
create or replace function public._purchase_request_amount(p_quantity numeric, p_unit text)
returns text
language sql
immutable
as $$
  select trim_scale(p_quantity)::text || coalesce(' ' || nullif(btrim(p_unit), ''), '');
$$;

revoke all on function public._purchase_request_amount(numeric, text) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Update to the SOR
-- ------------------------------------------------------------------------------

create or replace function public.purchase_request_update_item_from_sor(p_item_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fn constant text := 'purchase_request_update_item_from_sor';
  v_item public.purchase_request_items;
  v_line public.sales_opportunity_items;
  v_reason text := nullif(btrim(p_reason), '');
  v_unit text;
  v_before text;
  v_after text;
begin
  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception '%: item % not found', v_fn, p_item_id using errcode = 'P0002';
  end if;

  perform public._purchase_request_for_adding(v_item.request_id, v_fn);

  if v_item.source <> 'sor_line' then
    raise exception '%: only an item picked from the SOR can follow it', v_fn using errcode = '22023';
  end if;
  if v_item.status in ('from_stock', 'received', 'substituted', 'cannot_source', 'cancelled') then
    raise exception '%: this item is closed, so it keeps what was asked', v_fn using errcode = '22023';
  end if;

  v_line := public._purchase_request_item_sor_line(v_item);
  if v_line.id is null then
    raise exception '%: the SOR no longer has this line', v_fn using errcode = 'P0002';
  end if;
  if coalesce(v_line.quantity, 0) <= 0 then
    raise exception '%: the SOR line has no quantity', v_fn using errcode = '22023';
  end if;

  v_unit := nullif(btrim(v_line.unit), '');
  if v_line.quantity = (v_item.sor_line_snapshot->>'quantity')::numeric
     and lower(coalesce(v_unit, '')) = lower(coalesce(btrim(v_item.sor_line_snapshot->>'unit'), '')) then
    raise exception '%: the item already says what the SOR says', v_fn using errcode = '22023';
  end if;

  if v_item.status = 'ordered' and v_reason is null then
    raise exception '%: this item is already ordered, so say why it follows the SOR', v_fn using errcode = '22023';
  end if;

  v_before := public._purchase_request_amount(v_item.quantity, v_item.unit);
  v_after := public._purchase_request_amount(v_line.quantity, v_unit);

  update public.purchase_request_items
  set quantity = v_line.quantity,
      unit = v_unit,
      sor_line_snapshot = jsonb_set(
        jsonb_set(coalesce(sor_line_snapshot, '{}'::jsonb), '{quantity}', to_jsonb(v_line.quantity)),
        '{unit}', coalesce(to_jsonb(v_unit), 'null'::jsonb)
      ),
      sor_change_seen = null
  where id = v_item.id;

  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (
    v_item.request_id,
    public.get_employee_id(),
    format('Updated %s from %s to %s, as the SOR now says.', v_item.name, v_before, v_after)
      || coalesce(' Reason: ' || v_reason, ''),
    jsonb_build_object('event', 'item_followed_sor', 'item_id', v_item.id, 'from', v_before, 'to', v_after)
  );

  update public.purchase_requests set updated_at = now() where id = v_item.request_id;
end;
$$;

comment on function public.purchase_request_update_item_from_sor(uuid, text) is
  'Copies the SOR line''s quantity and unit into a Requested Item and its snapshot, and posts the change in the request. A reason is required once the item is Ordered; a closed item or a vanished line is refused.';

-- ------------------------------------------------------------------------------
-- Keep as asked
-- ------------------------------------------------------------------------------

create or replace function public.purchase_request_keep_item_as_asked(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fn constant text := 'purchase_request_keep_item_as_asked';
  v_item public.purchase_request_items;
  v_line public.sales_opportunity_items;
begin
  select * into v_item from public.purchase_request_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception '%: item % not found', v_fn, p_item_id using errcode = 'P0002';
  end if;

  perform public._purchase_request_for_adding(v_item.request_id, v_fn);

  if v_item.source <> 'sor_line' then
    raise exception '%: only an item picked from the SOR has a line to keep', v_fn using errcode = '22023';
  end if;
  if v_item.status in ('from_stock', 'received', 'substituted', 'cannot_source', 'cancelled') then
    raise exception '%: this item is closed, so it keeps what was asked', v_fn using errcode = '22023';
  end if;

  v_line := public._purchase_request_item_sor_line(v_item);
  if v_line.id is null then
    raise exception '%: the SOR no longer has this line', v_fn using errcode = 'P0002';
  end if;

  update public.purchase_request_items
  set sor_change_seen = jsonb_build_object('quantity', v_line.quantity, 'unit', nullif(btrim(v_line.unit), ''))
  where id = v_item.id;
end;
$$;

comment on function public.purchase_request_keep_item_as_asked(uuid) is
  'Records the SOR line''s quantity and unit the item was judged against, so the "SOR changed" flag stays quiet until the SOR says something else.';

revoke all on function public.purchase_request_update_item_from_sor(uuid, text) from public, anon;
revoke all on function public.purchase_request_keep_item_as_asked(uuid) from public, anon;
grant execute on function public.purchase_request_update_item_from_sor(uuid, text) to authenticated;
grant execute on function public.purchase_request_keep_item_as_asked(uuid) to authenticated;
