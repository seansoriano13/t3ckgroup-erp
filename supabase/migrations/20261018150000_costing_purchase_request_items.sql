-- Costing Matrix, Purchase Requests: Requested Items from Components (#273, spec #266).
--
-- WHAT THIS ADDS
--   purchase_request_items.component_id: the Component a Requested Item buys for
--   (nullable; ON DELETE SET NULL, so removing a Component leaves the item standing).
--   One Component may have many Requested Items; an item names at most one Component.
--   `source` gains 'component'.
--
--   purchase_request_add_items_from_components(request, component ids): Purchasing
--   access only. For each Component it adds a Requested Item that copies the name,
--   quantity, unit and Odoo product id (#268 amendment) and keeps its own copy, so
--   editing the Component later does not rewrite what was asked for. A Component on
--   another SOR's matrix is refused. All or nothing.
--
--   costing_component_requests(opportunity): the Costing Matrix grid's read. For each
--   Requested Item that names a Component of this SOR's matrix: id, component_id,
--   status, request_id. Nothing else (no name, quantity or requester), so the grid
--   can say what is being bought for a Component, at every tier, without widening
--   purchase_request_items' own read policy. Gated by costing_can_read.
--
--   purchase_request_component_labels(request): for the request view, each item that
--   names a Component with its number ("1.2") and name. Gated by can_read_purchase_request.
--
--   _purchase_request_item_added now words an item from a Component ("from the
--   Costing Matrix") instead of calling it a new product.
--
-- ACCESS
--   Adding: has_purchasing_access() only (not a sales-side member, not the Buyer unless
--   they also have Purchasing access). Reading: as above; the table's policies are not
--   changed.
--
-- SAFE TO RUN AT ANY TIME: one nullable column, a widened CHECK, new functions and one
-- redefined internal. Idempotent.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.purchase_request_items
  add column if not exists component_id uuid references public.costing_components (id) on delete set null;

comment on column public.purchase_request_items.component_id is
  '#273: the Costing Matrix Component this item buys for. Set when added from the matrix; null for an item from an SOR line or a new product, and after the Component is removed. The item keeps its own copy of name, quantity, unit and Odoo product id.';

alter table public.purchase_request_items drop constraint if exists purchase_request_items_source_chk;
alter table public.purchase_request_items
  add constraint purchase_request_items_source_chk check (source in ('sor_line', 'new', 'component'));

create index if not exists purchase_request_items_component_idx
  on public.purchase_request_items (component_id)
  where component_id is not null;

-- Functions
-- ---------------------------------------------------------------------------
-- The item_added message
-- ---------------------------------------------------------------------------

-- #305's function, with one more case: an item from a Component.
create or replace function public._purchase_request_item_added(p_item public.purchase_request_items)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount text := trim_scale(p_item.quantity)::text || coalesce(' ' || nullif(btrim(p_item.unit), ''), '');
begin
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (
    p_item.request_id,
    p_item.requested_by,
    case p_item.source
      when 'sor_line' then format('Requested %s × %s, from the SOR''s Product List.', p_item.name, v_amount)
      when 'component' then format('Requested %s × %s, from the Costing Matrix.', p_item.name, v_amount)
      else format('Requested a new product: %s × %s.', p_item.name, v_amount)
    end,
    jsonb_build_object('event', 'item_added', 'item_id', p_item.id, 'source', p_item.source)
  );

  update public.purchase_requests set updated_at = now() where id = p_item.request_id;
end;
$$;

revoke all on function public._purchase_request_item_added(public.purchase_request_items) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Component numbers ("1.2")
-- ---------------------------------------------------------------------------

-- Each given Component's number as the grid shows it: its Tender Line's place in the
-- matrix, a dot, its own place under that line (both in the grid's order: position,
-- then created_at). Internal.
create or replace function public._costing_component_labels(p_component_ids uuid[])
returns table (component_id uuid, label text, name text)
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select l.id, row_number() over (partition by l.matrix_id order by l.position, l.created_at) as n
    from public.costing_tender_lines l
    where l.matrix_id in (
      select tl.matrix_id
      from public.costing_tender_lines tl
      join public.costing_components c on c.tender_line_id = tl.id
      where c.id = any (p_component_ids)
    )
  ),
  components as (
    select c.id, c.name, lines.n,
      row_number() over (partition by c.tender_line_id order by c.position, c.created_at) as k
    from public.costing_components c
    join lines on lines.id = c.tender_line_id
  )
  select components.id, components.n || '.' || components.k, btrim(components.name)
  from components
  where components.id = any (p_component_ids)
$$;

revoke all on function public._costing_component_labels(uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Adding Requested Items from Components
-- ---------------------------------------------------------------------------

create or replace function public.purchase_request_add_items_from_components(p_request_id uuid, p_component_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req   public.purchase_requests;
  v_id    uuid;
  v_comp  public.costing_components;
  v_opp   uuid;
  v_item  public.purchase_request_items;
  v_added uuid[] := '{}';
begin
  if public.get_employee_id() is null then
    raise exception 'purchase_request_add_items_from_components: not signed in' using errcode = '42501';
  end if;
  if not public.has_purchasing_access() then
    raise exception 'purchase_request_add_items_from_components: only people with Purchasing access may add from the Costing Matrix'
      using errcode = '42501';
  end if;

  select * into v_req from public.purchase_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'purchase_request_add_items_from_components: request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_req.opportunity_id is null then
    raise exception 'purchase_request_add_items_from_components: this request has no SOR, so no Costing Matrix' using errcode = 'P0002';
  end if;
  if p_component_ids is null or cardinality(p_component_ids) = 0 then
    raise exception 'purchase_request_add_items_from_components: pick at least one Component' using errcode = '22023';
  end if;

  foreach v_id in array p_component_ids loop
    select * into v_comp from public.costing_components where id = v_id;
    select m.opportunity_id into v_opp
    from public.costing_tender_lines l
    join public.costing_matrices m on m.id = l.matrix_id
    where l.id = v_comp.tender_line_id;

    if v_comp.id is null or v_opp is distinct from v_req.opportunity_id then
      raise exception 'purchase_request_add_items_from_components: that Component is not on this SOR''s Costing Matrix'
        using errcode = 'P0002';
    end if;
    if nullif(btrim(v_comp.name), '') is null then
      raise exception 'purchase_request_add_items_from_components: a Component needs a name before it can be requested'
        using errcode = '22023';
    end if;

    insert into public.purchase_request_items
      (request_id, source, component_id, odoo_product_id, name, unit, quantity, requested_by)
    values
      (p_request_id, 'component', v_comp.id, v_comp.odoo_product_id, btrim(v_comp.name), nullif(btrim(v_comp.unit), ''),
       v_comp.quantity, public.get_employee_id())
    returning * into v_item;

    perform public._purchase_request_item_added(v_item);
    v_added := v_added || v_item.id;
  end loop;

  return v_added;
end;
$$;

comment on function public.purchase_request_add_items_from_components(uuid, uuid[]) is
  '#273: adds one Requested Item per given Component of the request''s SOR (name, quantity, unit and Odoo product id copied; the item keeps its own copy and names the Component), at Requested, and posts each in the request. Purchasing access only. A Component may be asked for more than once.';

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- What is being bought for each Component of the SOR's matrix: the Requested Items that
-- name one, with only their id, Component, status and request. Null when the caller has
-- no Costing Matrix tier.
create or replace function public.costing_component_requests(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_matrix uuid;
begin
  if not public.costing_can_read(p_opportunity_id) then
    return null;
  end if;
  select id into v_matrix from public.costing_matrices where opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', i.id, 'component_id', i.component_id, 'status', i.status, 'request_id', i.request_id)
        order by i.created_at, i.id
      ),
      '[]'::jsonb
    )
    from public.purchase_request_items i
    where i.component_id in (
      select c.id
      from public.costing_components c
      join public.costing_tender_lines l on l.id = c.tender_line_id
      where l.matrix_id = v_matrix
    )
  );
end;
$$;

comment on function public.costing_component_requests(uuid) is
  '#273: the Requested Items that name a Component of this SOR''s Costing Matrix, as {id, component_id, status, request_id} only. Readable by every tier that can read the matrix; the item''s own columns stay behind its table policy.';

-- Each item of the request that names a Component, with the Component's number and name:
-- [{ item_id, component_id, number, name }].
create or replace function public.purchase_request_component_labels(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_read_purchase_request(p_request_id) then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('item_id', i.id, 'component_id', i.component_id, 'number', x.label, 'name', x.name)
        order by i.created_at, i.id
      ),
      '[]'::jsonb
    )
    from public.purchase_request_items i
    join public._costing_component_labels(
      (select coalesce(array_agg(distinct it.component_id), '{}') from public.purchase_request_items it
        where it.request_id = p_request_id and it.component_id is not null)
    ) x on x.component_id = i.component_id
    where i.request_id = p_request_id
  );
end;
$$;

comment on function public.purchase_request_component_labels(uuid) is
  '#273: for each item of the request that names a Component, the Component''s number ("1.2") and name, so the request can show "1.2 · name". Readable by whoever can read the request.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.purchase_request_add_items_from_components(uuid, uuid[]) from public, anon;
revoke all on function public.costing_component_requests(uuid) from public, anon;
revoke all on function public.purchase_request_component_labels(uuid) from public, anon;
grant execute on function public.purchase_request_add_items_from_components(uuid, uuid[]) to authenticated;
grant execute on function public.costing_component_requests(uuid) to authenticated;
grant execute on function public.purchase_request_component_labels(uuid) to authenticated;
