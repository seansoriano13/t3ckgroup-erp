-- ==============================================================================
-- 20261104100000_sor_lines_keep_odoo_line_id.sql
--
-- #677 (spec #675): an SOR product line keeps the Odoo S0 line's own id.
--
-- BEFORE: every save of an SOR deleted and re-inserted every product line, so
-- every line got a new id each time, and everything that pointed at a line
-- (a Tender Line, a Requested Item) had to guess which new line was the old
-- one -- by Odoo product, else by name. Wrong on an SOR that lists a product
-- twice, or after a product is swapped in Odoo.
--
-- NOW:
--   * `sales_opportunity_items.odoo_line_id` stores the Odoo sale.order.line id.
--   * `sor_replace_items` matches incoming lines to stored lines:
--       1. by odoo_line_id            -> updated in place
--       2. by the line's own id       -> updated in place (hand edits)
--       3. an older line with no Odoo line id, by Odoo product id (once; it
--          carries the Odoo line id from then on)
--       4. otherwise                  -> added
--     A stored line with an Odoo line id that the S0 no longer has is kept and
--     marked `removed_from_s0`; it no longer counts toward Estimated Value. A
--     line typed by hand (no Odoo line id) that is not sent again is deleted,
--     as before. A line that is already as sent is not written at all.
--   * The three "find the SOR line" rules (costing_matching_sor_line,
--     purchase_request_item_lines, _purchase_request_item_sor_line) collapse
--     into one: the fixed line id. A Tender Line's `sor_item_id` becomes a
--     real foreign key; a Requested Item gets `sor_item_id` too.
--
-- Existing rows are backfilled once with the old rule so nothing already linked
-- is lost. Safe to run against a live frontend of any version: new columns are
-- nullable or defaulted, and sor_replace_items still accepts rows without them.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Columns
-- ------------------------------------------------------------------------------

alter table public.sales_opportunity_items
  add column if not exists odoo_line_id bigint,
  add column if not exists removed_from_s0 boolean not null default false;

comment on column public.sales_opportunity_items.odoo_line_id is
  'The Odoo S0 line''s own id (sale.order.line.id). Null on a line typed by hand and on older lines not yet matched to the S0. #677.';
comment on column public.sales_opportunity_items.removed_from_s0 is
  'True when the S0 no longer has this line. The line is kept (a purchase may hang off it) but is left out of Estimated Value. #677.';

create unique index if not exists sales_opportunity_items_odoo_line_uidx
  on public.sales_opportunity_items (opportunity_id, odoo_line_id)
  where odoo_line_id is not null;

-- Estimated Value leaves out a line the S0 dropped.
create or replace function public.sor_recalc_expected_value()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target_id uuid := coalesce(new.opportunity_id, old.opportunity_id);
begin
  update public.sales_opportunities
  set expected_value = coalesce((
    select sum(quantity * unit_price)
    from public.sales_opportunity_items
    where opportunity_id = target_id
      and not removed_from_s0
  ), 0)
  where id = target_id;
  return null; -- AFTER trigger; return value is ignored
end $function$;

-- A Participant's Items tab, with the removed flag so it can say so.
drop function if exists public.sor_participant_items(uuid);

create function public.sor_participant_items(p_opportunity_id uuid)
returns table (
  id uuid,
  opportunity_id uuid,
  product_name text,
  unit text,
  quantity numeric,
  sort_order integer,
  removed_from_s0 boolean
)
language sql
stable
security definer
set search_path = public
as $function$
  select i.id, i.opportunity_id, i.product_name, i.unit, i.quantity, i.sort_order, i.removed_from_s0
  from public.sales_opportunity_items i
  where i.opportunity_id = p_opportunity_id
    and public.sor_access_level(p_opportunity_id) in ('full', 'participant')
$function$;

comment on function public.sor_participant_items(uuid) is
  'ADR 0021 / #295: sales_opportunity_items without unit_price, for the participant Items tab. #677 adds removed_from_s0.';

revoke all on function public.sor_participant_items(uuid) from public, anon;
grant execute on function public.sor_participant_items(uuid) to authenticated;

-- Requested Items remember the SOR line they were picked from by its fixed id.
alter table public.purchase_request_items
  add column if not exists sor_item_id uuid references public.sales_opportunity_items (id) on delete set null;

comment on column public.purchase_request_items.sor_item_id is
  'The SOR product line this item was picked from, by the line''s fixed id (#677). Null for a typed item, or if the line was deleted.';

create index if not exists purchase_request_items_sor_item_id_idx
  on public.purchase_request_items (sor_item_id) where sor_item_id is not null;

-- ------------------------------------------------------------------------------
-- One-time backfill: point existing links at the line as it stands now, using the
-- old rule (Odoo product, else name, nearest quantity) for the last time.
-- ------------------------------------------------------------------------------

update public.purchase_request_items i
set sor_item_id = (
  select sl.id
  from public.purchase_requests r
  join public.sales_opportunity_items sl on sl.opportunity_id = r.opportunity_id
  where r.id = i.request_id
    and case
      when i.odoo_product_id is not null then sl.odoo_product_id = i.odoo_product_id
      else lower(btrim(sl.product_name)) = lower(btrim(i.sor_line_snapshot ->> 'name'))
    end
  order by (sl.quantity = (i.sor_line_snapshot ->> 'quantity')::numeric) desc, sl.sort_order, sl.created_at
  limit 1
)
where i.source = 'sor_line' and i.sor_item_id is null;

-- A Tender Line's sor_item_id may point at a line an earlier save deleted: move it
-- to the line that stands now, else clear it, so the foreign key can be added.
select set_config('costing.bypass', 'on', true);

update public.costing_tender_lines l
set sor_item_id = (
  select sl.id
  from public.costing_matrices m
  join public.sales_opportunity_items sl on sl.opportunity_id = m.opportunity_id
  where m.id = l.matrix_id
    and case
      when l.odoo_product_id is not null then sl.odoo_product_id = l.odoo_product_id
      else lower(btrim(sl.product_name)) = lower(btrim(l.sor_line_snapshot ->> 'name'))
    end
  order by (sl.quantity = (l.sor_line_snapshot ->> 'quantity')::numeric) desc, sl.sort_order, sl.created_at
  limit 1
)
where l.source = 'sor_line'
  and not exists (select 1 from public.sales_opportunity_items x where x.id = l.sor_item_id);

update public.costing_tender_lines l
set sor_item_id = null
where l.sor_item_id is not null
  and not exists (select 1 from public.sales_opportunity_items x where x.id = l.sor_item_id);

select set_config('costing.bypass', '', true);

alter table public.costing_tender_lines
  drop constraint if exists costing_tender_lines_sor_item_id_fkey;
alter table public.costing_tender_lines
  add constraint costing_tender_lines_sor_item_id_fkey
  foreign key (sor_item_id) references public.sales_opportunity_items (id) on delete set null;

comment on column public.costing_tender_lines.sor_item_id is
  'The SOR line it was picked from, by the line''s fixed id (#677). A real foreign key: SOR saves update lines in place, so it stays true.';

-- ------------------------------------------------------------------------------
-- The one rule: the fixed line id
-- ------------------------------------------------------------------------------

-- The SOR line a Tender Line was picked from. A line the S0 dropped counts as gone.
create or replace function public.costing_matching_sor_line(p_tender_line_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select sl.id
  from public.costing_tender_lines l
  join public.sales_opportunity_items sl on sl.id = l.sor_item_id
  where l.id = p_tender_line_id
    and l.source = 'sor_line'
    and not sl.removed_from_s0
$$;

create or replace function public._purchase_request_item_sor_line(p_item public.purchase_request_items)
returns public.sales_opportunity_items
language sql
stable
security definer
set search_path = public
as $$
  select sl.*
  from public.sales_opportunity_items sl
  where sl.id = p_item.sor_item_id
    and not sl.removed_from_s0;
$$;

revoke all on function public._purchase_request_item_sor_line(public.purchase_request_items) from public, anon, authenticated;

create or replace function public.purchase_request_item_lines(p_request_id uuid)
returns table (
  item_id uuid,
  line_found boolean,
  line_quantity numeric,
  line_unit text
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, l.id is not null, l.quantity, nullif(btrim(l.unit), '')
  from purchase_request_items i
  left join sales_opportunity_items l on l.id = i.sor_item_id and not l.removed_from_s0
  where i.request_id = p_request_id
    and i.source = 'sor_line'
    and can_read_purchase_request(p_request_id);
$$;

-- The picker lists live lines only.
create or replace function public.purchase_request_pickable_lines(p_request_id uuid)
returns table (
  id uuid,
  product_name text,
  quantity numeric,
  unit text,
  odoo_product_id integer,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests := public._purchase_request_for_adding(p_request_id, 'purchase_request_pickable_lines');
begin
  return query
    select l.id, l.product_name, l.quantity, l.unit, l.odoo_product_id, l.sort_order
    from public.sales_opportunity_items l
    where l.opportunity_id = v_req.opportunity_id
      and not l.removed_from_s0
    order by l.sort_order, l.created_at;
end;
$$;

create or replace function public.purchase_request_add_item_from_line(p_request_id uuid, p_line_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.purchase_requests := public._purchase_request_for_adding(p_request_id, 'purchase_request_add_item_from_line');
  v_line public.sales_opportunity_items;
  v_name text;
  v_unit text;
  v_item public.purchase_request_items;
begin
  select * into v_line from public.sales_opportunity_items where id = p_line_id;
  if v_line.id is null or v_line.opportunity_id is distinct from v_req.opportunity_id or v_line.removed_from_s0 then
    raise exception 'purchase_request_add_item_from_line: that line is no longer on this SOR''s Product List'
      using errcode = 'P0002';
  end if;
  if coalesce(v_line.quantity, 0) <= 0 then
    raise exception 'purchase_request_add_item_from_line: that line has no quantity' using errcode = '22023';
  end if;

  v_name := btrim(v_line.product_name);
  v_unit := nullif(btrim(v_line.unit), '');

  insert into public.purchase_request_items
    (request_id, source, odoo_product_id, sor_item_id, name, unit, quantity, sor_line_snapshot, requested_by)
  values
    (p_request_id, 'sor_line', v_line.odoo_product_id, v_line.id, v_name, v_unit, v_line.quantity,
     jsonb_build_object('name', v_name, 'quantity', v_line.quantity, 'unit', v_unit),
     public.get_employee_id())
  returning * into v_item;

  perform public._purchase_request_item_added(v_item);
  return v_item.id;
end;
$$;

-- The SOR modal's overview now carries each item's line id.
create or replace function public.sor_purchase_request_overview(p_opportunity_id uuid)
returns table (
  request_id uuid,
  buyer_id uuid,
  buyer_name text,
  buyer_avatar_path text,
  opened_visit_id uuid,
  created_at timestamptz,
  items jsonb
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    r.id,
    r.buyer_id,
    b.name,
    b.avatar_path,
    r.opened_visit_id,
    r.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', it.id,
        'name', it.name,
        'odoo_product_id', it.odoo_product_id,
        'sor_item_id', it.sor_item_id,
        'quantity', it.quantity,
        'unit', it.unit,
        'status', it.status,
        'source', it.source,
        'created_at', it.created_at
      ) order by it.created_at, it.id)
      from public.purchase_request_items it
      where it.request_id = r.id
    ), '[]'::jsonb)
  from public.purchase_requests r
  left join public.employees b on b.id = r.buyer_id
  where r.opportunity_id = p_opportunity_id
    and public.can_read_purchase_request(r.id);
$function$;

-- "Refresh from the SOR" skips a line the S0 dropped. Because line ids are now
-- stable it also adds nothing twice.
create or replace function public.costing_fill_from_sor(p_opportunity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := public.get_employee_id();
  v_matrix uuid;
  v_pos    integer;
  v_line   uuid;
  v_unit   text;
  v_added  integer := 0;
  v_item   record;
begin
  if v_actor is null then
    raise exception 'costing_fill: sign in first' using errcode = '42501';
  end if;
  select m.id into v_matrix from public.costing_matrices m where m.opportunity_id = p_opportunity_id;
  if v_matrix is null then
    raise exception 'costing_fill: this SOR has no Costing Matrix yet' using errcode = '22023';
  end if;
  if not (public.costing_can_read(p_opportunity_id)
          and (public.costing_in_band(p_opportunity_id, 'sales') or public.costing_in_band(p_opportunity_id, 'purchasing'))) then
    raise exception 'costing_fill: only Sales or Purchasing can fill the matrix from the SOR' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('costing_fill:' || v_matrix::text));
  perform set_config('costing.bypass', 'on', true);

  select coalesce(max(l.position), 0) into v_pos from public.costing_tender_lines l where l.matrix_id = v_matrix;

  for v_item in
    select i.*
    from public.sales_opportunity_items i
    where i.opportunity_id = p_opportunity_id
      and not i.removed_from_s0
      and not exists (
        select 1 from public.costing_tender_lines l where l.matrix_id = v_matrix and l.sor_item_id = i.id
      )
    order by i.sort_order, i.created_at, i.id
  loop
    v_pos := v_pos + 1;
    v_unit := nullif(btrim(coalesce(v_item.unit, '')), '');
    insert into public.costing_tender_lines (
      matrix_id, position, source, sor_item_id, odoo_product_id, tender_specification, unit, quantity, sor_line_snapshot, created_by
    ) values (
      v_matrix, v_pos, 'sor_line', v_item.id, v_item.odoo_product_id, v_item.product_name, v_unit,
      case when v_item.quantity > 0 then v_item.quantity else 1 end,
      jsonb_build_object('name', v_item.product_name, 'quantity', v_item.quantity, 'unit', v_unit),
      v_actor
    )
    returning id into v_line;

    -- A Component's quantity is for the whole line (its totals are unit x quantity), so the product
    -- carries the line's quantity.
    insert into public.costing_components (tender_line_id, position, name, quantity, unit, odoo_product_id)
    values (v_line, 1, v_item.product_name, case when v_item.quantity > 0 then v_item.quantity else 1 end, v_unit, v_item.odoo_product_id);

    v_added := v_added + 1;
  end loop;

  perform set_config('costing.bypass', '', true);
  return v_added;
end;
$$;

-- ------------------------------------------------------------------------------
-- The save: update in place by Odoo line id
-- ------------------------------------------------------------------------------

drop function if exists public.sor_replace_items(uuid, jsonb);

create function public.sor_replace_items(
  p_opportunity_id uuid,
  p_items jsonb
)
returns setof sales_opportunity_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in        record;
  v_name      text;
  v_line_id   bigint;
  v_prod_id   integer;
  v_item_id   uuid;
  v_match     uuid;
  v_matched   uuid[] := '{}';
  v_seen      bigint[] := '{}';
  v_unit      text;
  v_qty       numeric;
  v_price     numeric;
  v_removed   boolean;
  v_order     integer;
begin
  if public.get_employee_id() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- Serializes concurrent replaces of the same opportunity's Product List
  -- (see 20260929030000). Locked before the authorization check so a caller
  -- who fails it still releases the lock immediately (the transaction ends).
  perform 1 from public.sales_opportunities where id = p_opportunity_id for update;

  if not public.sor_can_edit_opportunity(p_opportunity_id) then
    raise exception 'You cannot edit this opportunity''s Product List.' using errcode = '42501';
  end if;

  -- The "before" snapshot, handed back for the caller's change log -- read here,
  -- bypassing RLS (see 20260929040000).
  return query
    select * from public.sales_opportunity_items where opportunity_id = p_opportunity_id;

  for v_in in
    select t.item, t.ordinality
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(item, ordinality)
    order by t.ordinality
  loop
    v_name := nullif(trim(v_in.item ->> 'product_name'), '');
    if v_name is null then
      continue;
    end if;

    v_line_id := nullif(v_in.item ->> 'odoo_line_id', '')::bigint;
    v_prod_id := nullif(v_in.item ->> 'odoo_product_id', '')::int;
    v_item_id := nullif(v_in.item ->> 'id', '')::uuid;
    v_unit := nullif(trim(v_in.item ->> 'unit'), '');
    v_qty := coalesce(nullif(v_in.item ->> 'quantity', '')::numeric, 0);
    v_price := coalesce(nullif(v_in.item ->> 'unit_price', '')::numeric, 0);
    v_removed := coalesce(nullif(v_in.item ->> 'removed_from_s0', '')::boolean, false);
    v_order := (v_in.ordinality - 1)::int;

    -- One Odoo line is one line: a repeat of the same id in one call is ignored.
    if v_line_id is not null then
      if v_line_id = any (v_seen) then
        continue;
      end if;
      v_seen := v_seen || v_line_id;
    end if;

    v_match := null;

    -- 1. The Odoo line id.
    if v_line_id is not null then
      select i.id into v_match
      from public.sales_opportunity_items i
      where i.opportunity_id = p_opportunity_id and i.odoo_line_id = v_line_id and i.id <> all (v_matched);
    end if;

    -- 2. The line's own id (a hand edit sends it back). A line already bound to a
    --    different Odoo line is not this one.
    if v_match is null and v_item_id is not null then
      select i.id into v_match
      from public.sales_opportunity_items i
      where i.opportunity_id = p_opportunity_id and i.id = v_item_id and i.id <> all (v_matched)
        and (v_line_id is null or i.odoo_line_id is null or i.odoo_line_id = v_line_id);
    end if;

    -- 3. An older line with no Odoo line id: matched once by Odoo product id.
    if v_match is null and v_prod_id is not null then
      select i.id into v_match
      from public.sales_opportunity_items i
      where i.opportunity_id = p_opportunity_id and i.odoo_line_id is null
        and i.odoo_product_id = v_prod_id and i.id <> all (v_matched)
      order by i.sort_order, i.created_at, i.id
      limit 1;
    end if;

    if v_match is not null then
      -- Written only when something differs: opening an SOR that has not
      -- changed in Odoo writes nothing.
      update public.sales_opportunity_items i
      set product_name = v_name,
          unit = v_unit,
          quantity = v_qty,
          unit_price = v_price,
          sort_order = v_order,
          odoo_product_id = v_prod_id,
          odoo_line_id = coalesce(v_line_id, i.odoo_line_id),
          removed_from_s0 = v_removed
      where i.id = v_match
        and (i.product_name, i.unit, i.quantity, i.unit_price, i.sort_order, i.odoo_product_id, i.odoo_line_id, i.removed_from_s0)
            is distinct from
            (v_name, v_unit, v_qty, v_price, v_order, v_prod_id, coalesce(v_line_id, i.odoo_line_id), v_removed);
    else
      insert into public.sales_opportunity_items (
        opportunity_id, product_name, unit, quantity, unit_price, sort_order, odoo_product_id, odoo_line_id, removed_from_s0
      ) values (
        p_opportunity_id, v_name, v_unit, v_qty, v_price, v_order, v_prod_id, v_line_id, v_removed
      )
      returning id into v_match;
    end if;

    v_matched := v_matched || v_match;
  end loop;

  -- A line the S0 no longer has is kept and marked, never deleted.
  update public.sales_opportunity_items i
  set removed_from_s0 = true
  where i.opportunity_id = p_opportunity_id
    and i.odoo_line_id is not null
    and not i.removed_from_s0
    and i.id <> all (v_matched);

  -- A line typed by hand that is not sent again is deleted, as it always was. A
  -- Tender Line or Requested Item pointing at it is cleared by its foreign key; the
  -- bypass keeps the costing band trigger from judging whoever saved the SOR.
  perform set_config('costing.bypass', 'on', true);
  delete from public.sales_opportunity_items i
  where i.opportunity_id = p_opportunity_id
    and i.odoo_line_id is null
    and i.id <> all (v_matched);
  perform set_config('costing.bypass', '', true);

  return;
end;
$$;

grant execute on function public.sor_replace_items(uuid, jsonb) to authenticated;
