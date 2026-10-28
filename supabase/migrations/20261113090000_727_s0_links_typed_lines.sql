-- S0 Evaluation, the S0 links to typed lines (#727, spec #718 "Tender-first lines", ADR 0041).
--
-- "Refresh from the SOR" (costing_fill_from_sor, the #700 refresh path) matches each live S0 line,
-- in the S0's order:
--   1. a Tender Line that already holds the S0 line's Odoo line id        -> linked
--   2. else an unlinked typed line with the same Odoo product              -> linked
--   3. else a new row (as before)
-- A line is never linked by name. Typed lines with a similar name are returned by
-- costing_s0_link_suggestions for Sales to confirm with costing_link_to_s0_line.
--
-- Linking stores the SOR line (sor_item_id) and its Odoo line id (odoo_line_id), turns the row into
-- an S0 line (source 'sor_line') and refreshes the S0 snapshot. It touches no Component, Canvass,
-- cost, compliance note or multiplier, so the line keeps its work. It changes no money, so it is
-- allowed while a Go locks the sheet (the lock lets an update through that changes only the link
-- columns while costing.s0_link is on; a new row is still a change, so under a Go step 3 is skipped).
-- Idempotent.

-- 1. The Odoo line id on a Tender Line --------------------------------------------------------

alter table public.costing_tender_lines add column if not exists odoo_line_id bigint;

comment on column public.costing_tender_lines.odoo_line_id is
  'The Odoo S0 line''s own id (sales_opportunity_items.odoo_line_id) once the row is linked to the S0. Null on a typed line not yet on the S0. #727.';

create unique index if not exists costing_tender_lines_odoo_line_uidx
  on public.costing_tender_lines (matrix_id, odoo_line_id)
  where odoo_line_id is not null;

-- Lines already picked from the S0 take the Odoo line id of their SOR line.
select set_config('costing.bypass', 'on', true);
update public.costing_tender_lines l
   set odoo_line_id = i.odoo_line_id
  from public.sales_opportunity_items i
 where i.id = l.sor_item_id
   and i.odoo_line_id is not null
   and l.odoo_line_id is null
   and not exists (
     select 1 from public.costing_tender_lines x
      where x.matrix_id = l.matrix_id and x.odoo_line_id = i.odoo_line_id);
select set_config('costing.bypass', '', true);

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_tender_lines', 'odoo_line_id', '{participant,price,cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_tender_lines', 'odoo_line_id', '{sales}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

-- 2. The Go lock lets a link through -------------------------------------------------------------

create or replace function public.costing_refuse_when_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_matrix uuid;
  v_link   text[] := array['sor_item_id', 'odoo_line_id', 'source', 'sor_line_snapshot', 'odoo_product_id'];
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_matrix := public.costing_matrix_of(tg_table_name, v_row);
  if v_matrix is not null
     and exists (select 1 from public.costing_matrices where id = v_matrix)
     and exists (select 1 from public.costing_bid_decisions d
                  where d.matrix_id = v_matrix and d.cleared_at is null and d.verdict = 'go') then
    -- Linking a Tender Line to the S0 changes no money: only the link columns differ.
    if tg_table_name = 'costing_tender_lines' and tg_op = 'UPDATE'
       and coalesce(current_setting('costing.s0_link', true), '') = 'on'
       and (to_jsonb(new) - v_link) = (to_jsonb(old) - v_link) then
      return new;
    end if;
    raise exception 'costing_bid: the sheet is locked by a Go. Unlock it, with a reason, to change it' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.costing_refuse_when_locked() from public, anon, authenticated;

-- 3. Refresh from the S0 ------------------------------------------------------------------------

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
  v_match  uuid;
  v_unit   text;
  v_added  integer := 0;
  v_locked boolean;
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
  perform set_config('costing.s0_link', 'on', true);

  v_locked := exists (select 1 from public.costing_bid_decisions d
                       where d.matrix_id = v_matrix and d.cleared_at is null and d.verdict = 'go');

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
    v_unit := nullif(btrim(coalesce(v_item.unit, '')), '');
    v_match := null;

    -- 1. A line that already holds this Odoo line id (its SOR line was replaced or is gone).
    if v_item.odoo_line_id is not null then
      select l.id into v_match
        from public.costing_tender_lines l
       where l.matrix_id = v_matrix
         and l.odoo_line_id = v_item.odoo_line_id
         and (l.sor_item_id is null
              or exists (select 1 from public.sales_opportunity_items o where o.id = l.sor_item_id and o.removed_from_s0))
       order by l.position, l.id
       limit 1;
    end if;

    -- 2. Else an unlinked typed line with the same Odoo product. Never by name.
    if v_match is null and v_item.odoo_product_id is not null then
      select l.id into v_match
        from public.costing_tender_lines l
       where l.matrix_id = v_matrix
         and l.source = 'typed'
         and l.sor_item_id is null
         and l.odoo_line_id is null
         and l.odoo_product_id = v_item.odoo_product_id
       order by l.position, l.id
       limit 1;
    end if;

    if v_match is not null then
      update public.costing_tender_lines
         set sor_item_id = v_item.id,
             odoo_line_id = v_item.odoo_line_id,
             source = 'sor_line',
             odoo_product_id = coalesce(v_item.odoo_product_id, odoo_product_id),
             sor_line_snapshot = jsonb_build_object('name', v_item.product_name, 'quantity', v_item.quantity, 'unit', v_unit)
       where id = v_match;
      continue;
    end if;

    -- 3. Else a new row. Adding a row is a change to the sheet, so a Go lock holds it back.
    if v_locked then
      continue;
    end if;
    v_pos := v_pos + 1;
    insert into public.costing_tender_lines (
      matrix_id, position, source, sor_item_id, odoo_line_id, odoo_product_id, tender_specification, unit, quantity, sor_line_snapshot, created_by
    ) values (
      v_matrix, v_pos, 'sor_line', v_item.id, v_item.odoo_line_id, v_item.odoo_product_id, v_item.product_name, v_unit,
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

  -- A line already linked picks up its S0 line's Odoo line id when it has none yet.
  update public.costing_tender_lines l
     set odoo_line_id = i.odoo_line_id
    from public.sales_opportunity_items i
   where l.matrix_id = v_matrix
     and i.id = l.sor_item_id
     and i.odoo_line_id is not null
     and l.odoo_line_id is null
     and not exists (select 1 from public.costing_tender_lines x where x.matrix_id = v_matrix and x.odoo_line_id = i.odoo_line_id);

  perform set_config('costing.s0_link', '', true);
  perform set_config('costing.bypass', '', true);
  return v_added;
end;
$$;

comment on function public.costing_fill_from_sor(uuid) is
  'Refresh from the S0: links each live S0 line to the line holding its Odoo line id, else an unlinked typed line with the same Odoo product, else adds a row (not while a Go locks the sheet; returns how many it added). Never links by name. Sales or Purchasing. #727.';

revoke all on function public.costing_fill_from_sor(uuid) from public, anon;
grant execute on function public.costing_fill_from_sor(uuid) to authenticated;

-- 4. Suggestions, for Sales to confirm -----------------------------------------------------------

create or replace function public.costing_name_words(p_name text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct w), '{}'::text[])
  from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')), ' ')) as w
  where length(w) >= 2
$$;

-- S0 lines not yet on a Tender Line, each with the unlinked typed lines whose name is similar (they
-- share at least 60% of the shorter name's words). Offered, never linked.
create or replace function public.costing_s0_link_suggestions(p_opportunity_id uuid)
returns table (sor_item_id uuid, sor_item_name text, tender_line_id uuid, tender_line_name text, score numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_matrix uuid;
begin
  select m.id into v_matrix from public.costing_matrices m where m.opportunity_id = p_opportunity_id;
  if v_matrix is null then
    raise exception 'costing_fill: this SOR has no Costing Matrix yet' using errcode = '22023';
  end if;
  if not (public.costing_can_read(p_opportunity_id)
          and (public.costing_in_band(p_opportunity_id, 'sales') or public.costing_in_band(p_opportunity_id, 'purchasing'))) then
    raise exception 'costing_fill: only Sales or Purchasing can see S0 link suggestions' using errcode = '42501';
  end if;
  return query
  select s.item_id, s.item_name, s.line_id, s.line_name, s.score
  from (
    select i.id as item_id, i.product_name as item_name, l.id as line_id, l.tender_specification as line_name,
           round(
             (select count(*) from unnest(public.costing_name_words(i.product_name)) a
               where a = any(public.costing_name_words(l.tender_specification)))::numeric
             / nullif(least(cardinality(public.costing_name_words(i.product_name)),
                            cardinality(public.costing_name_words(l.tender_specification))), 0), 2) as score
    from public.sales_opportunity_items i
    join public.costing_tender_lines l on l.matrix_id = v_matrix and l.source = 'typed' and l.sor_item_id is null
    where i.opportunity_id = p_opportunity_id
      and not i.removed_from_s0
      and not exists (select 1 from public.costing_tender_lines x where x.matrix_id = v_matrix and x.sor_item_id = i.id)
  ) s
  where s.score >= 0.6
  order by s.score desc, s.item_name, s.line_name;
end;
$$;

revoke all on function public.costing_s0_link_suggestions(uuid) from public, anon;
grant execute on function public.costing_s0_link_suggestions(uuid) to authenticated;

-- 5. Sales confirms a suggestion -----------------------------------------------------------------

create or replace function public.costing_link_to_s0_line(p_tender_line_id uuid, p_sor_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_line  public.costing_tender_lines;
  v_item  public.sales_opportunity_items;
  v_opp   uuid;
  v_unit  text;
begin
  if v_actor is null then
    raise exception 'costing_link: sign in first' using errcode = '42501';
  end if;
  select * into v_line from public.costing_tender_lines where id = p_tender_line_id for update;
  if not found then
    raise exception 'costing_link: line not found' using errcode = '22023';
  end if;
  v_opp := public.costing_matrix_opp(v_line.matrix_id);
  if v_opp is null or not (public.costing_can_read(v_opp) and public.costing_in_band(v_opp, 'sales')) then
    raise exception 'costing_link: only Sales can link a line to the S0' using errcode = '42501';
  end if;
  if v_line.source <> 'typed' or v_line.sor_item_id is not null then
    raise exception 'costing_link: only a typed line not yet on the S0 can be linked' using errcode = '22023';
  end if;
  select * into v_item from public.sales_opportunity_items where id = p_sor_item_id;
  if not found or v_item.opportunity_id <> v_opp or v_item.removed_from_s0 then
    raise exception 'costing_link: that S0 line is not on this SOR' using errcode = '22023';
  end if;
  if exists (select 1 from public.costing_tender_lines x where x.matrix_id = v_line.matrix_id and x.sor_item_id = v_item.id) then
    raise exception 'costing_link: that S0 line is already linked to a line' using errcode = '22023';
  end if;

  v_unit := nullif(btrim(coalesce(v_item.unit, '')), '');
  perform set_config('costing.bypass', 'on', true);
  perform set_config('costing.s0_link', 'on', true);
  update public.costing_tender_lines
     set sor_item_id = v_item.id,
         odoo_line_id = v_item.odoo_line_id,
         source = 'sor_line',
         odoo_product_id = coalesce(v_item.odoo_product_id, odoo_product_id),
         sor_line_snapshot = jsonb_build_object('name', v_item.product_name, 'quantity', v_item.quantity, 'unit', v_unit)
   where id = v_line.id;
  perform set_config('costing.s0_link', '', true);
  perform set_config('costing.bypass', '', true);
end;
$$;

comment on function public.costing_link_to_s0_line(uuid, uuid) is
  'Sales confirms that a typed line is an S0 line (a suggestion from costing_s0_link_suggestions). Stores the SOR line and its Odoo line id; Components, Canvasses, costs, compliance and multiplier stay. Allowed while Go-locked. #727.';

revoke all on function public.costing_link_to_s0_line(uuid, uuid) from public, anon;
grant execute on function public.costing_link_to_s0_line(uuid, uuid) to authenticated;
