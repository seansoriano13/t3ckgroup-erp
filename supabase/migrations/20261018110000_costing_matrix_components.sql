-- Costing Matrix, part 2: Components, bundles, Inclusions and cost-only rows (#268, spec #266).
--
-- WHAT THIS ADDS
--   Tables: costing_components (what T3CK supplies toward a Tender Line, with the
--   Odoo product id the amendment asks for), costing_component_costs (its Acquire,
--   Odoo, Final Acquire unit costs and markup factor), costing_inclusions (the
--   unpriced check rows under a bundle Component) and costing_cost_rows (rows
--   below the Tender Lines, like the Delivery Charge: description, quantity and
--   the same four money columns).
--
--   Everything goes through the registries #267 built, as rows: costing_tables,
--   costing_column_tiers (#319's tiers: Acquire -> cost + closed_book; Odoo unit ->
--   price, cost, closed_book; Final Acquire and the markup factor -> closed_book
--   only), costing_column_bands (Brand, Status, Odoo unit -> Sales; P.O./RFQ No.,
--   availability, Source, Acquire, Offer Specification -> Purchasing; Final Acquire
--   and the markup factor -> Management; adding and removing rows -> Sales or
--   Purchasing; an Inclusion's Completeness -> Technical).
--
--   Rules held by the database:
--     - an Inclusion sits under a bundle Component only (trigger), and a bundle
--       that still has Inclusions cannot stop being one;
--     - the Sales incharge is on the Deal Team and the Purchasing incharge has
--       Purchasing access, for the matrix and for a Component's override (trigger).
--       It grants nothing and notifies nobody.
--
--   RPCs: costing_move_inclusion (refuses a non-bundle target), costing_add_cost_row,
--   costing_remove_cost_row. Money on cost-only rows and Components is written
--   through costing_set_money, as in #267.
--
--   Changes to #267's generic functions (behaviour, not just rows):
--     - costing_enforce_bands: on INSERT a column whose value is its own default is
--       not "given", so a new Inclusion's default Completeness or a new cost-only
--       row's x1.00 factor is not judged against a band the adder isn't in;
--     - costing_set_money: finds the matrix of a money row that carries matrix_id
--       itself (costing_cost_rows);
--     - costing_tender_lines_cleanup: removes a Tender Line's Components, with their
--       costs and Inclusions, before the line, so the history keeps what went.
--
--   sor_inclusions: its rows move under an "Unplaced inclusions" bundle Component on
--   an "Unplaced inclusions" Tender Line, per SOR (costing_move_legacy_inclusions,
--   run once here, keeps Completeness and records cost_amount in the event detail).
--   A SOR with old Inclusions gets its matrix opened by the move. The old table is
--   kept and becomes read-only.
--
-- ACCESS
--   costing_components and costing_inclusions are read by anyone with a tier.
--   costing_component_costs and costing_cost_rows hold money: read directly only at
--   the closed_book tier; costing_matrix_read serves everyone else their own columns
--   (a cost-only row's description and quantity reach every tier that can read the
--   matrix). Writes to the two money tables go through costing_set_money and the
--   cost-row RPCs; the band trigger judges them with the real auth.uid().
--
-- SAFE TO RUN AT ANY TIME: new tables, functions, policies and registry rows; the
-- one-off move of sor_inclusions is idempotent. Idempotent.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.costing_components (
  id                     uuid primary key default gen_random_uuid(),
  tender_line_id         uuid not null references public.costing_tender_lines (id) on delete cascade,
  position               integer not null,
  name                   text not null default '',
  offer_specification    text,
  brand                  text,
  status                 text,
  availability           text,
  source                 text,
  po_rfq_no              text,
  is_bundle              boolean not null default false,
  quantity               numeric(12,2) not null default 1,
  unit                   text,
  -- Shows the product's stock, and is how Landed Cost later finds its way back (#318, #283).
  odoo_product_id        integer,
  -- Null = the matrix's incharge. Names only: no access, no notification.
  sales_incharge_id      uuid references public.employees (id) on delete set null,
  purchasing_incharge_id uuid references public.employees (id) on delete set null,
  created_at             timestamptz not null default now(),

  constraint costing_components_status_chk check (status is null or status in ('source_out', 'stockable')),
  constraint costing_components_availability_chk check (availability is null or availability in ('available', 'for_order')),
  constraint costing_components_source_chk check (source is null or source in ('local', 'import')),
  constraint costing_components_quantity_chk check (quantity > 0)
);

create index if not exists costing_components_line_idx
  on public.costing_components (tender_line_id, position);

comment on table public.costing_components is
  '#268: one thing T3CK supplies toward a Tender Line. A bundle (is_bundle) is priced as a whole and lists Inclusions. Non-money; read by anyone with a costing tier. Money is in costing_component_costs.';

create table if not exists public.costing_component_costs (
  component_id       uuid primary key references public.costing_components (id) on delete cascade,
  acquire_unit       numeric(18,2),
  odoo_unit          numeric(18,2),
  final_acquire_unit numeric(18,2),
  -- Null = the matrix default (#269). Set by the Final Acquire list.
  markup_factor      numeric(10,4),

  constraint costing_component_costs_acquire_chk check (acquire_unit is null or acquire_unit >= 0),
  constraint costing_component_costs_odoo_chk check (odoo_unit is null or odoo_unit >= 0),
  constraint costing_component_costs_final_chk check (final_acquire_unit is null or final_acquire_unit >= 0),
  constraint costing_component_costs_factor_chk check (markup_factor is null or markup_factor > 0)
);

comment on table public.costing_component_costs is
  '#268: a Component''s unit costs. Money table: no direct reads below closed_book, written only through costing_set_money. A missing row means nothing typed yet. Each column has its own read tiers and write band (costing_column_tiers, costing_column_bands).';

create table if not exists public.costing_inclusions (
  id                     uuid primary key default gen_random_uuid(),
  component_id           uuid not null references public.costing_components (id) on delete cascade,
  heading                text,
  position               integer not null,
  description            text not null,
  quantity               numeric(12,2) not null default 1,
  unit                   text,
  completeness           text not null default 'MISSING',
  -- The sor_inclusions row this one was moved from (#268). Not served to any client.
  legacy_sor_inclusion_id uuid,
  created_at             timestamptz not null default now(),

  constraint costing_inclusions_completeness_chk check (completeness in ('COVERED', 'MISSING', 'SUBSTITUTED', 'NOT_REQUIRED')),
  constraint costing_inclusions_quantity_chk check (quantity > 0)
);

create index if not exists costing_inclusions_component_idx
  on public.costing_inclusions (component_id, position);

create unique index if not exists costing_inclusions_legacy_key
  on public.costing_inclusions (legacy_sor_inclusion_id)
  where legacy_sor_inclusion_id is not null;

comment on table public.costing_inclusions is
  '#268: an unpriced check row under a bundle Component, optionally under a heading ("Accessories", "With"). Completeness is the bid-time check of what sits inside the bundle. A trigger keeps it under a bundle.';

create table if not exists public.costing_cost_rows (
  id                 uuid primary key default gen_random_uuid(),
  matrix_id          uuid not null references public.costing_matrices (id) on delete cascade,
  position           integer not null,
  description        text not null default '',
  quantity           numeric(12,2) not null default 1,
  acquire_unit       numeric(18,2),
  odoo_unit          numeric(18,2),
  final_acquire_unit numeric(18,2),
  markup_factor      numeric(10,4) default 1.00,
  created_at         timestamptz not null default now(),

  constraint costing_cost_rows_quantity_chk check (quantity > 0),
  constraint costing_cost_rows_acquire_chk check (acquire_unit is null or acquire_unit >= 0),
  constraint costing_cost_rows_odoo_chk check (odoo_unit is null or odoo_unit >= 0),
  constraint costing_cost_rows_final_chk check (final_acquire_unit is null or final_acquire_unit >= 0),
  constraint costing_cost_rows_factor_chk check (markup_factor is null or markup_factor > 0)
);

create index if not exists costing_cost_rows_matrix_idx
  on public.costing_cost_rows (matrix_id, position);

comment on table public.costing_cost_rows is
  '#268: a cost-only row below the Tender Lines (like the Delivery Charge): it counts in the totals and the summary, not in any Tender Line''s margin. Registered as a money table (written through costing_set_money and the cost-row RPCs, read directly only at closed_book), but its description and quantity are served to every tier that reads the matrix.';

-- Functions
-- ---------------------------------------------------------------------------
-- Generic functions, extended
-- ---------------------------------------------------------------------------

-- A column's default, as jsonb (null when it has none). The band trigger uses it so
-- an INSERT that leaves a column at its default doesn't count as writing it.
create or replace function public.costing_column_default(p_table regclass, p_column text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_expr text;
  v_val  jsonb;
begin
  select pg_get_expr(d.adbin, d.adrelid) into v_expr
  from pg_attrdef d
  join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
  where d.adrelid = p_table and a.attname = p_column;
  if v_expr is null then
    return null;
  end if;
  execute format('select to_jsonb(%s)', v_expr) into v_val;
  return v_val;
exception when others then
  return null;
end;
$$;

-- #267's trigger, with one change: on INSERT a registered column counts as given
-- only when it is non-null and differs from its default. Everything else is as it was.
create or replace function public.costing_enforce_bands()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new    jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_matrix uuid;
  v_opp    uuid;
  v_band   record;
  v_needed boolean;
  v_ok     boolean;
  b        text;
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or coalesce(current_setting('costing.bypass', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_matrix := public.costing_matrix_of(tg_table_name, coalesce(v_new, v_old));
  v_opp := public.costing_matrix_opp(v_matrix);
  if v_opp is null then
    -- The matrix is going (an SOR cascade): nothing left to judge.
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  for v_band in select * from public.costing_column_bands where table_name = tg_table_name loop
    v_needed := case
      when v_band.column_name = '*' then tg_op in ('INSERT', 'DELETE')
      when tg_op = 'INSERT' then
        (v_new -> v_band.column_name) is not null
        and (v_new -> v_band.column_name) <> 'null'::jsonb
        and (v_new -> v_band.column_name) is distinct from public.costing_column_default(tg_relid, v_band.column_name)
      when tg_op = 'UPDATE' then (v_new -> v_band.column_name) is distinct from (v_old -> v_band.column_name)
      else false
    end;
    if not v_needed then
      continue;
    end if;
    v_ok := false;
    foreach b in array v_band.bands loop
      if public.costing_in_band(v_opp, b) then
        v_ok := true;
        exit;
      end if;
    end loop;
    if not v_ok then
      raise exception using
        errcode = '42501',
        message = format('costing_band:%s.%s:%s', tg_table_name, v_band.column_name, array_to_string(v_band.bands, ','));
    end if;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- #267's money write, with one change: a money row that carries matrix_id itself
-- (a cost-only row, keyed by its own id) is looked up to find its matrix.
create or replace function public.costing_set_money(p_table text, p_row uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_def    public.costing_tables;
  v_matrix uuid;
  v_opp    uuid;
  v_key    text;
  v_sets   text;
  v_cols   text;
  v_count  integer;
  v_found  jsonb;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_set_money: sign in first' using errcode = '42501';
  end if;
  select * into v_def from public.costing_tables where table_name = p_table and money;
  if not found then
    raise exception 'costing_set_money: % is not a money table', p_table using errcode = '22023';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'costing_set_money: nothing to change' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key = '*' or not exists (
      select 1 from public.costing_column_bands where table_name = p_table and column_name = v_key
    ) then
      raise exception 'costing_set_money: % is not a column of %', v_key, p_table using errcode = '22023';
    end if;
  end loop;

  if v_def.parent_table is null and v_def.key_column <> 'matrix_id' then
    execute format('select to_jsonb(t) from public.%I t where t.%I = $1', p_table, v_def.key_column)
      into v_found using p_row;
    v_matrix := public.costing_matrix_of(p_table, v_found);
  else
    v_matrix := public.costing_matrix_of(p_table, jsonb_build_object(v_def.key_column, p_row));
  end if;
  v_opp := public.costing_matrix_opp(v_matrix);
  if v_opp is null then
    raise exception 'costing_set_money: not found' using errcode = 'P0002';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_set_money: not allowed' using errcode = '42501';
  end if;

  select string_agg(format('%I = r.%I', k, k), ', '), string_agg(format('%I', k), ', ')
    into v_sets, v_cols
    from jsonb_object_keys(p_patch) k;

  execute format(
    'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.%I = $2',
    p_table, v_sets, p_table, v_def.key_column
  ) using p_patch, p_row;
  get diagnostics v_count = row_count;

  if v_count = 0 and (v_def.parent_table is not null or v_def.key_column = 'matrix_id') then
    execute format(
      'insert into public.%I (%I, %s) select $2, %s from jsonb_populate_record(null::public.%I, $1) r',
      p_table, v_def.key_column, v_cols,
      (select string_agg(format('r.%I', k), ', ') from jsonb_object_keys(p_patch) k),
      p_table
    ) using p_patch, p_row;
  end if;
end;
$$;

-- A Tender Line takes its prices and its Components (with their costs and
-- Inclusions) with it, so the removal is in the history with the figures it had.
create or replace function public.costing_tender_lines_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.costing_components where tender_line_id = old.id;
  delete from public.costing_tender_line_prices where tender_line_id = old.id;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rules held by the database
-- ---------------------------------------------------------------------------

-- A Component takes its costs and Inclusions with it, for the same reason.
create or replace function public.costing_components_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.costing_inclusions where component_id = old.id;
  delete from public.costing_component_costs where component_id = old.id;
  return old;
end;
$$;

-- An Inclusion sits under a bundle Component, only.
create or replace function public.costing_inclusion_needs_bundle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.costing_components c where c.id = new.component_id and c.is_bundle) then
    raise exception 'costing_inclusion: an Inclusion can only sit under a bundle Component'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- A bundle that still lists Inclusions stays a bundle.
create or replace function public.costing_bundle_keeps_inclusions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_bundle and not new.is_bundle
     and exists (select 1 from public.costing_inclusions i where i.component_id = new.id) then
    raise exception 'costing_inclusion: move or remove this Component''s Inclusions before it stops being a bundle'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- The Sales incharge is on the SOR's Deal Team and the Purchasing incharge has
-- Purchasing access. Checked when the value is set or changed, on the matrix and on
-- a Component's override. It grants nothing and notifies nobody.
create or replace function public.costing_check_incharge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp uuid;
  v_sor public.sales_opportunities;
begin
  -- A new matrix is not there to look up yet; it names its SOR itself.
  v_opp := case
    when tg_table_name = 'costing_matrices' then (to_jsonb(new) ->> 'opportunity_id')::uuid
    else public.costing_matrix_opp(public.costing_matrix_of(tg_table_name, to_jsonb(new)))
  end;
  if v_opp is null then
    return new;
  end if;
  -- costing_open_matrix inserts "on conflict do nothing": a row that is about to be
  -- dropped for the matrix the SOR already has is not judged.
  if tg_op = 'INSERT' and tg_table_name = 'costing_matrices'
     and exists (select 1 from public.costing_matrices m where m.opportunity_id = v_opp) then
    return new;
  end if;
  select * into v_sor from public.sales_opportunities where id = v_opp;

  if new.sales_incharge_id is not null
     and (tg_op = 'INSERT' or new.sales_incharge_id is distinct from old.sales_incharge_id)
     and not coalesce(public.sor_is_deal_team(v_sor, new.sales_incharge_id), false) then
    raise exception 'costing_incharge: the Sales incharge must be on the SOR''s Deal Team'
      using errcode = '23514';
  end if;

  if new.purchasing_incharge_id is not null
     and (tg_op = 'INSERT' or new.purchasing_incharge_id is distinct from old.purchasing_incharge_id)
     and not public._employee_has_purchasing_access(new.purchasing_incharge_id) then
    raise exception 'costing_incharge: the Purchasing incharge must have Purchasing access'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.costing_column_default(regclass, text) from public, anon, authenticated;
revoke all on function public.costing_components_cleanup() from public, anon, authenticated;
revoke all on function public.costing_inclusion_needs_bundle() from public, anon, authenticated;
revoke all on function public.costing_bundle_keeps_inclusions() from public, anon, authenticated;
revoke all on function public.costing_check_incharge() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['costing_components', 'costing_component_costs', 'costing_inclusions', 'costing_cost_rows'] loop
    execute format('drop trigger if exists costing_bands on public.%I', t);
    execute format('create trigger costing_bands before insert or update or delete on public.%I for each row execute function public.costing_enforce_bands()', t);
    execute format('drop trigger if exists costing_events_write on public.%I', t);
    execute format('create trigger costing_events_write after insert or update or delete on public.%I for each row execute function public.costing_write_events()', t);
  end loop;
end;
$$;

drop trigger if exists costing_components_cleanup on public.costing_components;
create trigger costing_components_cleanup before delete on public.costing_components
  for each row execute function public.costing_components_cleanup();

drop trigger if exists costing_bundle_keeps_inclusions on public.costing_components;
create trigger costing_bundle_keeps_inclusions before update of is_bundle on public.costing_components
  for each row execute function public.costing_bundle_keeps_inclusions();

drop trigger if exists costing_inclusion_needs_bundle on public.costing_inclusions;
create trigger costing_inclusion_needs_bundle before insert or update of component_id on public.costing_inclusions
  for each row execute function public.costing_inclusion_needs_bundle();

drop trigger if exists costing_check_incharge on public.costing_components;
create trigger costing_check_incharge before insert or update of sales_incharge_id, purchasing_incharge_id on public.costing_components
  for each row execute function public.costing_check_incharge();

drop trigger if exists costing_check_incharge on public.costing_matrices;
create trigger costing_check_incharge before insert or update of sales_incharge_id, purchasing_incharge_id on public.costing_matrices
  for each row execute function public.costing_check_incharge();

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Moves an Inclusion under another Component of the same matrix, at the end of its
-- list. Refuses a target that is not a bundle. The move is a write like any other:
-- the band trigger judges it as the caller (Sales or Purchasing).
create or replace function public.costing_move_inclusion(p_inclusion_id uuid, p_component_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inc    public.costing_inclusions;
  v_target public.costing_components;
  v_from   uuid;
  v_to     uuid;
  v_opp    uuid;
begin
  select * into v_inc from public.costing_inclusions where id = p_inclusion_id;
  if not found then
    raise exception 'costing_move_inclusion: Inclusion not found' using errcode = 'P0002';
  end if;
  select * into v_target from public.costing_components where id = p_component_id;
  if not found then
    raise exception 'costing_move_inclusion: Component not found' using errcode = 'P0002';
  end if;

  v_from := public.costing_matrix_of('costing_inclusions', to_jsonb(v_inc));
  v_to := public.costing_matrix_of('costing_components', to_jsonb(v_target));
  v_opp := public.costing_matrix_opp(v_from);
  if v_opp is null or not public.costing_can_read(v_opp) then
    raise exception 'costing_move_inclusion: not allowed' using errcode = '42501';
  end if;
  if v_from is distinct from v_to then
    raise exception 'costing_move_inclusion: the Component is on another SOR''s matrix' using errcode = '22023';
  end if;
  if not v_target.is_bundle then
    raise exception 'costing_move_inclusion: an Inclusion can only sit under a bundle Component' using errcode = '23514';
  end if;
  if v_inc.component_id = p_component_id then
    return;
  end if;

  update public.costing_inclusions
     set component_id = p_component_id,
         position = coalesce((select max(i.position) from public.costing_inclusions i where i.component_id = p_component_id), 0) + 1
   where id = p_inclusion_id;
end;
$$;

-- Adds a cost-only row at the end of the matrix with the default x1.00 factor. Its
-- money is typed afterwards through costing_set_money. Returns the new row's id.
create or replace function public.costing_add_cost_row(p_matrix_id uuid, p_description text default '', p_quantity numeric default 1)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp uuid := public.costing_matrix_opp(p_matrix_id);
  v_id  uuid;
begin
  if v_opp is null then
    raise exception 'costing_add_cost_row: not found' using errcode = 'P0002';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_add_cost_row: not allowed' using errcode = '42501';
  end if;
  insert into public.costing_cost_rows (matrix_id, position, description, quantity)
  values (
    p_matrix_id,
    coalesce((select max(r.position) from public.costing_cost_rows r where r.matrix_id = p_matrix_id), 0) + 1,
    coalesce(p_description, ''),
    coalesce(p_quantity, 1)
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.costing_remove_cost_row(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matrix uuid;
  v_opp    uuid;
begin
  select matrix_id into v_matrix from public.costing_cost_rows where id = p_row_id;
  v_opp := public.costing_matrix_opp(v_matrix);
  if v_opp is null then
    raise exception 'costing_remove_cost_row: not found' using errcode = 'P0002';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_remove_cost_row: not allowed' using errcode = '42501';
  end if;
  delete from public.costing_cost_rows where id = p_row_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The move of sor_inclusions
-- ---------------------------------------------------------------------------

-- Moves every sor_inclusions row not yet moved (of one SOR, or of all) under an
-- "Unplaced inclusions" bundle Component on an "Unplaced inclusions" Tender Line of
-- that SOR's matrix, opening the matrix if the SOR has none. Completeness is kept.
-- What the matrix has no column for (cost_amount, its source and date, note,
-- sourcing) is recorded in an event on the new Inclusion: a 'changed' event on the
-- pseudo-column legacy_sor_inclusion, whose new value holds them. Idempotent: a row
-- moved once is never moved again. Returns how many rows it moved.
create or replace function public.costing_move_legacy_inclusions(p_opportunity_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp    uuid;
  v_matrix uuid;
  v_line   uuid;
  v_comp   uuid;
  v_inc    uuid;
  v_old    public.sor_inclusions;
  v_count  integer := 0;
begin
  for v_opp in
    select distinct i.opportunity_id
    from public.sor_inclusions i
    where (p_opportunity_id is null or i.opportunity_id = p_opportunity_id)
      and not exists (select 1 from public.costing_inclusions c where c.legacy_sor_inclusion_id = i.id)
    order by 1
  loop
    v_matrix := public.costing_open_matrix(v_opp);

    select l.id into v_line
    from public.costing_tender_lines l
    where l.matrix_id = v_matrix and l.tender_specification = 'Unplaced inclusions'
    order by l.position
    limit 1;
    if v_line is null then
      insert into public.costing_tender_lines (matrix_id, position, tender_specification, quantity, source)
      values (v_matrix, coalesce((select max(l.position) from public.costing_tender_lines l where l.matrix_id = v_matrix), 0) + 1,
              'Unplaced inclusions', 1, 'typed')
      returning id into v_line;
    end if;

    select c.id into v_comp
    from public.costing_components c
    where c.tender_line_id = v_line and c.is_bundle and c.name = 'Unplaced inclusions'
    order by c.position
    limit 1;
    if v_comp is null then
      insert into public.costing_components (tender_line_id, position, name, is_bundle, quantity)
      values (v_line, coalesce((select max(c.position) from public.costing_components c where c.tender_line_id = v_line), 0) + 1,
              'Unplaced inclusions', true, 1)
      returning id into v_comp;
    end if;

    for v_old in
      select * from public.sor_inclusions i
      where i.opportunity_id = v_opp
        and not exists (select 1 from public.costing_inclusions c where c.legacy_sor_inclusion_id = i.id)
      order by i.sort_order, i.created_at, i.id
    loop
      insert into public.costing_inclusions
        (component_id, heading, position, description, quantity, unit, completeness, legacy_sor_inclusion_id, created_at)
      values (
        v_comp, null,
        coalesce((select max(c.position) from public.costing_inclusions c where c.component_id = v_comp), 0) + 1,
        v_old.description, v_old.quantity, v_old.unit, v_old.completeness, v_old.id, v_old.created_at
      )
      returning id into v_inc;

      insert into public.costing_events (matrix_id, actor_id, kind, detail)
      values (v_matrix, null, 'changed', jsonb_build_object(
        'table', 'costing_inclusions',
        'row', v_inc,
        'column', 'legacy_sor_inclusion',
        'old', null,
        'new', jsonb_build_object(
          'sor_inclusion_id', v_old.id,
          'cost_amount', v_old.cost_amount,
          'cost_source', v_old.cost_source,
          'cost_established_at', v_old.cost_established_at,
          'note', v_old.note,
          'sourcing', v_old.sourcing
        )
      ));
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.costing_components enable row level security;
alter table public.costing_component_costs enable row level security;
alter table public.costing_inclusions enable row level security;
alter table public.costing_cost_rows enable row level security;

revoke all on table public.costing_components, public.costing_component_costs,
  public.costing_inclusions, public.costing_cost_rows from anon, authenticated;

grant select, insert, update, delete on public.costing_components to authenticated;
grant select on public.costing_component_costs to authenticated;
grant select, insert, update, delete on public.costing_inclusions to authenticated;
grant select on public.costing_cost_rows to authenticated;

-- Non-money tables: anyone with a tier on the SOR. The band trigger decides who may
-- write which column.
drop policy if exists costing_components_read on public.costing_components;
create policy costing_components_read on public.costing_components
  for select to authenticated
  using (public.costing_row_tier('costing_components', jsonb_build_object('tender_line_id', tender_line_id)) is not null);

drop policy if exists costing_components_insert on public.costing_components;
create policy costing_components_insert on public.costing_components
  for insert to authenticated
  with check (public.costing_row_tier('costing_components', jsonb_build_object('tender_line_id', tender_line_id)) is not null);

drop policy if exists costing_components_update on public.costing_components;
create policy costing_components_update on public.costing_components
  for update to authenticated
  using (public.costing_row_tier('costing_components', jsonb_build_object('tender_line_id', tender_line_id)) is not null)
  with check (public.costing_row_tier('costing_components', jsonb_build_object('tender_line_id', tender_line_id)) is not null);

drop policy if exists costing_components_delete on public.costing_components;
create policy costing_components_delete on public.costing_components
  for delete to authenticated
  using (public.costing_row_tier('costing_components', jsonb_build_object('tender_line_id', tender_line_id)) is not null);

drop policy if exists costing_inclusions_read on public.costing_inclusions;
create policy costing_inclusions_read on public.costing_inclusions
  for select to authenticated
  using (public.costing_row_tier('costing_inclusions', jsonb_build_object('component_id', component_id)) is not null);

drop policy if exists costing_inclusions_insert on public.costing_inclusions;
create policy costing_inclusions_insert on public.costing_inclusions
  for insert to authenticated
  with check (public.costing_row_tier('costing_inclusions', jsonb_build_object('component_id', component_id)) is not null);

drop policy if exists costing_inclusions_update on public.costing_inclusions;
create policy costing_inclusions_update on public.costing_inclusions
  for update to authenticated
  using (public.costing_row_tier('costing_inclusions', jsonb_build_object('component_id', component_id)) is not null)
  with check (public.costing_row_tier('costing_inclusions', jsonb_build_object('component_id', component_id)) is not null);

drop policy if exists costing_inclusions_delete on public.costing_inclusions;
create policy costing_inclusions_delete on public.costing_inclusions
  for delete to authenticated
  using (public.costing_row_tier('costing_inclusions', jsonb_build_object('component_id', component_id)) is not null);

-- Money tables: the closed_book tier only. Everyone else reads them through
-- costing_matrix_read.
drop policy if exists costing_component_costs_read on public.costing_component_costs;
create policy costing_component_costs_read on public.costing_component_costs
  for select to authenticated
  using (public.costing_row_tier('costing_component_costs', jsonb_build_object('component_id', component_id)) = 'closed_book');

drop policy if exists costing_cost_rows_read on public.costing_cost_rows;
create policy costing_cost_rows_read on public.costing_cost_rows
  for select to authenticated
  using (public.costing_tier(public.costing_matrix_opp(matrix_id)) = 'closed_book');

revoke all on function public.costing_move_inclusion(uuid, uuid) from public, anon;
grant execute on function public.costing_move_inclusion(uuid, uuid) to authenticated;
revoke all on function public.costing_add_cost_row(uuid, text, numeric) from public, anon;
grant execute on function public.costing_add_cost_row(uuid, text, numeric) to authenticated;
revoke all on function public.costing_remove_cost_row(uuid) from public, anon;
grant execute on function public.costing_remove_cost_row(uuid) to authenticated;
-- The old-table move: the migration runs it; so may the service role (tests).
revoke all on function public.costing_move_legacy_inclusions(uuid) from public, anon, authenticated;
grant execute on function public.costing_move_legacy_inclusions(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Registry rows
-- ---------------------------------------------------------------------------

insert into public.costing_tables (table_name, parent_table, parent_column, parent_key, key_column, order_by, money) values
  ('costing_components', 'costing_tender_lines', 'tender_line_id', 'id', 'id', 't.position, t.created_at', false),
  ('costing_cost_rows', null, null, 'id', 'id', 't.position, t.created_at', true)
on conflict (table_name) do update
  set parent_table = excluded.parent_table, parent_column = excluded.parent_column,
      parent_key = excluded.parent_key, key_column = excluded.key_column,
      order_by = excluded.order_by, money = excluded.money;

insert into public.costing_tables (table_name, parent_table, parent_column, parent_key, key_column, order_by, money) values
  ('costing_component_costs', 'costing_components', 'component_id', 'id', 'component_id', 't.component_id', true),
  ('costing_inclusions', 'costing_components', 'component_id', 'id', 'id', 't.position, t.created_at', false)
on conflict (table_name) do update
  set parent_table = excluded.parent_table, parent_column = excluded.parent_column,
      parent_key = excluded.parent_key, key_column = excluded.key_column,
      order_by = excluded.order_by, money = excluded.money;

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_components', 'id', '{participant,price,cost,closed_book}'),
  ('costing_components', 'tender_line_id', '{participant,price,cost,closed_book}'),
  ('costing_components', 'position', '{participant,price,cost,closed_book}'),
  ('costing_components', 'name', '{participant,price,cost,closed_book}'),
  ('costing_components', 'offer_specification', '{participant,price,cost,closed_book}'),
  ('costing_components', 'brand', '{participant,price,cost,closed_book}'),
  ('costing_components', 'status', '{participant,price,cost,closed_book}'),
  ('costing_components', 'availability', '{participant,price,cost,closed_book}'),
  ('costing_components', 'source', '{participant,price,cost,closed_book}'),
  ('costing_components', 'po_rfq_no', '{participant,price,cost,closed_book}'),
  ('costing_components', 'is_bundle', '{participant,price,cost,closed_book}'),
  ('costing_components', 'quantity', '{participant,price,cost,closed_book}'),
  ('costing_components', 'unit', '{participant,price,cost,closed_book}'),
  ('costing_components', 'odoo_product_id', '{participant,price,cost,closed_book}'),
  ('costing_components', 'sales_incharge_id', '{participant,price,cost,closed_book}'),
  ('costing_components', 'purchasing_incharge_id', '{participant,price,cost,closed_book}'),
  ('costing_components', 'created_at', '{participant,price,cost,closed_book}'),
  ('costing_inclusions', 'id', '{participant,price,cost,closed_book}'),
  ('costing_inclusions', 'component_id', '{participant,price,cost,closed_book}'),
  ('costing_inclusions', 'heading', '{participant,price,cost,closed_book}'),
  ('costing_inclusions', 'position', '{participant,price,cost,closed_book}'),
  ('costing_inclusions', 'description', '{participant,price,cost,closed_book}'),
  ('costing_inclusions', 'quantity', '{participant,price,cost,closed_book}'),
  ('costing_inclusions', 'unit', '{participant,price,cost,closed_book}'),
  ('costing_inclusions', 'completeness', '{participant,price,cost,closed_book}'),
  ('costing_inclusions', 'created_at', '{participant,price,cost,closed_book}'),
  -- #319: Acquire is the cost side's; the Odoo unit cost is Sales's own column and
  -- Purchasing reads it; Final Acquire and the markup factor are Closed Book only.
  ('costing_component_costs', 'component_id', '{price,cost,closed_book}'),
  ('costing_component_costs', 'acquire_unit', '{cost,closed_book}'),
  ('costing_component_costs', 'odoo_unit', '{price,cost,closed_book}'),
  ('costing_component_costs', 'final_acquire_unit', '{closed_book}'),
  ('costing_component_costs', 'markup_factor', '{closed_book}'),
  -- A cost-only row: what it is and how many reach every tier; its money follows the
  -- same rule as a Component's.
  ('costing_cost_rows', 'id', '{participant,price,cost,closed_book}'),
  ('costing_cost_rows', 'matrix_id', '{participant,price,cost,closed_book}'),
  ('costing_cost_rows', 'position', '{participant,price,cost,closed_book}'),
  ('costing_cost_rows', 'description', '{participant,price,cost,closed_book}'),
  ('costing_cost_rows', 'quantity', '{participant,price,cost,closed_book}'),
  ('costing_cost_rows', 'created_at', '{participant,price,cost,closed_book}'),
  ('costing_cost_rows', 'acquire_unit', '{cost,closed_book}'),
  ('costing_cost_rows', 'odoo_unit', '{price,cost,closed_book}'),
  ('costing_cost_rows', 'final_acquire_unit', '{closed_book}'),
  ('costing_cost_rows', 'markup_factor', '{closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_components', '*', '{sales,purchasing}'),
  ('costing_components', 'tender_line_id', '{sales,purchasing}'),
  ('costing_components', 'position', '{sales,purchasing}'),
  ('costing_components', 'name', '{sales,purchasing}'),
  ('costing_components', 'is_bundle', '{sales,purchasing}'),
  ('costing_components', 'quantity', '{sales,purchasing}'),
  ('costing_components', 'unit', '{sales,purchasing}'),
  ('costing_components', 'odoo_product_id', '{sales,purchasing}'),
  ('costing_components', 'brand', '{sales}'),
  ('costing_components', 'status', '{sales}'),
  ('costing_components', 'offer_specification', '{purchasing}'),
  ('costing_components', 'availability', '{purchasing}'),
  ('costing_components', 'source', '{purchasing}'),
  ('costing_components', 'po_rfq_no', '{purchasing}'),
  ('costing_components', 'sales_incharge_id', '{sales}'),
  ('costing_components', 'purchasing_incharge_id', '{purchasing}'),
  -- A costs row appears the first time any column of it is typed, and the Final
  -- Acquire list may type before Sales or Purchasing has.
  ('costing_component_costs', '*', '{sales,purchasing,management}'),
  ('costing_component_costs', 'acquire_unit', '{purchasing}'),
  ('costing_component_costs', 'odoo_unit', '{sales}'),
  ('costing_component_costs', 'final_acquire_unit', '{management}'),
  ('costing_component_costs', 'markup_factor', '{management}'),
  ('costing_inclusions', '*', '{sales,purchasing}'),
  ('costing_inclusions', 'component_id', '{sales,purchasing}'),
  ('costing_inclusions', 'heading', '{sales,purchasing}'),
  ('costing_inclusions', 'position', '{sales,purchasing}'),
  ('costing_inclusions', 'description', '{sales,purchasing}'),
  ('costing_inclusions', 'quantity', '{sales,purchasing}'),
  ('costing_inclusions', 'unit', '{sales,purchasing}'),
  ('costing_inclusions', 'completeness', '{technical}'),
  ('costing_cost_rows', '*', '{sales,purchasing}'),
  ('costing_cost_rows', 'position', '{sales,purchasing}'),
  ('costing_cost_rows', 'description', '{sales,purchasing}'),
  ('costing_cost_rows', 'quantity', '{sales,purchasing}'),
  ('costing_cost_rows', 'acquire_unit', '{purchasing}'),
  ('costing_cost_rows', 'odoo_unit', '{sales}'),
  ('costing_cost_rows', 'final_acquire_unit', '{management}'),
  ('costing_cost_rows', 'markup_factor', '{management}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

-- ---------------------------------------------------------------------------
-- sor_inclusions becomes read-only, and its rows move
-- ---------------------------------------------------------------------------

drop policy if exists "sor_inclusions_insert" on public."sor_inclusions";
drop policy if exists "sor_inclusions_update" on public."sor_inclusions";
drop policy if exists "sor_inclusions_delete" on public."sor_inclusions";
revoke insert, update, delete, truncate on public."sor_inclusions" from anon, authenticated;

comment on table public."sor_inclusions" is
  '#268: read-only. Its rows were moved under an "Unplaced inclusions" bundle Component of the SOR''s Costing Matrix (costing_move_legacy_inclusions); Inclusions live in costing_inclusions now.';

select public.costing_move_legacy_inclusions();
