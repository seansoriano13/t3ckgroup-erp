-- Costing Matrix, part 1: Tender Lines and the access model (#267, spec #266).
--
-- WHAT THIS ADDS
--   Tables: costing_matrices (one per SOR), costing_matrix_money,
--   costing_tender_lines, costing_tender_line_prices, costing_events
--   (trigger-written, append-only) and costing_signer_lists (empty).
--
--   The access model every later Costing Matrix ticket extends by adding
--   registry rows, not by rewriting these functions:
--     costing_tier(opp)              the caller's read tier: closed_book, cost,
--                                    price, participant, or null
--     costing_can_read(opp)          the tier is not null
--     costing_tables                 the tables of a matrix and how they link up
--     costing_column_tiers           which tiers read which column (default deny)
--     costing_virtual_columns        computed columns, evaluated only for a tier
--                                    that may read them
--     costing_column_bands           which write bands may change which column
--                                    ('*' = insert / delete of a row)
--     costing_matrix_read(opp)       the matrix as jsonb, each row cut down to the
--                                    caller's columns (a key the tier may not read
--                                    is absent, not null)
--     costing_history(opp, ...)      costing_events cut down the same way
--     costing_enforce_bands()        the one BEFORE trigger every costing table has
--     costing_set_money(...)         the one way to write a money table
--     costing_open_matrix(opp, cfg)  creates the SOR's matrix (idempotent)
--
--   There is no registration trigger and no backfill (#461, #462): a matrix
--   exists only once costing_open_matrix has run for the SOR.
--
-- ACCESS
--   Non-money tables are read by anyone with a tier. Money tables
--   (costing_matrix_money, costing_tender_line_prices) and costing_events are
--   read directly only at the closed_book tier; everyone else gets money through
--   costing_matrix_read, which serves each tier its own columns (#319). Writes to
--   a money table go through costing_set_money. The band trigger refuses a
--   write outside a column's band on every client path.
--
-- SAFE TO RUN AT ANY TIME: new tables, functions, policies and registry rows.
-- Idempotent.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.costing_matrices (
  id                    uuid primary key default gen_random_uuid(),
  opportunity_id        uuid not null references public.sales_opportunities (id) on delete cascade,
  sales_incharge_id     uuid references public.employees (id) on delete set null,
  purchasing_incharge_id uuid references public.employees (id) on delete set null,
  bid_submitted_at      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint costing_matrices_opportunity_key unique (opportunity_id)
);

comment on table public.costing_matrices is
  '#267: one Costing Matrix per SOR, created by costing_open_matrix (no registration trigger, no backfill). Read by anyone with a costing tier.';

create table if not exists public.costing_matrix_money (
  matrix_id   uuid primary key references public.costing_matrices (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.costing_matrix_money is
  '#267: the matrix''s own money columns. Later tickets add columns here (default markup factor, Marketing, OPEX) and register them. Read directly only at the closed_book tier; written through costing_set_money.';

create table if not exists public.costing_tender_lines (
  id                   uuid primary key default gen_random_uuid(),
  matrix_id            uuid not null references public.costing_matrices (id) on delete cascade,
  position             integer not null,
  tender_specification text not null default '',
  unit                 text,
  quantity             numeric(12,2) not null default 1,
  source               text not null default 'typed',
  -- The SOR line it was picked from. No foreign key on purpose: sor_replace_items
  -- deletes and re-inserts every line on each save, and a SET NULL cascade would
  -- run the band trigger as whoever saved the SOR. The current line is found by
  -- Odoo product id, else by name (costing_matching_sor_line).
  sor_item_id          uuid,
  odoo_product_id      integer,
  sor_line_snapshot    jsonb,
  created_by           uuid references public.employees (id) on delete set null,
  created_at           timestamptz not null default now(),

  constraint costing_tender_lines_source_chk check (source in ('typed', 'sor_line')),
  constraint costing_tender_lines_quantity_chk check (quantity > 0)
);

create index if not exists costing_tender_lines_matrix_idx
  on public.costing_tender_lines (matrix_id, position);

comment on table public.costing_tender_lines is
  '#267: what the client asked for. Typed, or picked from an SOR line whose name, quantity and unit it keeps in sor_line_snapshot.';

create table if not exists public.costing_tender_line_prices (
  tender_line_id   uuid primary key references public.costing_tender_lines (id) on delete cascade,
  abc_unit         numeric(18,2),
  final_offer_unit numeric(18,2),

  constraint costing_tender_line_prices_abc_chk check (abc_unit is null or abc_unit >= 0),
  constraint costing_tender_line_prices_offer_chk check (final_offer_unit is null or final_offer_unit >= 0)
);

comment on table public.costing_tender_line_prices is
  '#267: a Tender Line''s ABC and Final Offer, per unit. Money table: no direct reads below closed_book, written only through costing_set_money. A missing row means nothing typed yet.';

create table if not exists public.costing_events (
  id         uuid primary key default gen_random_uuid(),
  matrix_id  uuid not null references public.costing_matrices (id) on delete cascade,
  actor_id   uuid references public.employees (id),
  kind       text not null,
  detail     jsonb not null,
  created_at timestamptz not null default now(),

  constraint costing_events_kind_chk check (kind in ('added', 'changed', 'removed'))
);

create index if not exists costing_events_matrix_idx
  on public.costing_events (matrix_id, created_at desc);

comment on table public.costing_events is
  '#267: the matrix''s history, written by triggers. Append-only for every role. detail is {table, row, column, old, new} for a change and {table, row, values} for an add or a remove. Read directly only at the closed_book tier; costing_history serves the others their own columns.';

create table if not exists public.costing_signer_lists (
  id          uuid primary key default gen_random_uuid(),
  list_key    text not null,
  employee_id uuid not null references public.employees (id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint costing_signer_lists_key_chk check (list_key in ('final_acquire', 'evaluation')),
  constraint costing_signer_lists_unique unique (list_key, employee_id)
);

comment on table public.costing_signer_lists is
  '#267: who is on the Final Acquire list (Closed Book, Final Acquire writes) and the evaluation list. Starts empty; Super Admins fill it.';

-- The registries.

create table if not exists public.costing_tables (
  table_name    text primary key,
  -- Null when the table carries matrix_id itself (costing_matrices: its own id).
  parent_table  text references public.costing_tables (table_name),
  parent_column text,
  parent_key    text not null default 'id',
  key_column    text not null default 'id',
  order_by      text not null default 't.created_at',
  money         boolean not null default false
);

comment on table public.costing_tables is
  '#267: the tables of a Costing Matrix and how each finds its matrix. Read by costing_matrix_read, the band trigger and the event writer. money = written only through costing_set_money.';

create table if not exists public.costing_column_tiers (
  table_name  text not null,
  column_name text not null,
  tiers       text[] not null,
  primary key (table_name, column_name),

  constraint costing_column_tiers_tiers_chk check (tiers <@ array['participant', 'price', 'cost', 'closed_book']::text[])
);

comment on table public.costing_column_tiers is
  '#267: which read tiers may read a column. Default deny: a column with no row is never returned by costing_matrix_read or costing_history.';

create table if not exists public.costing_virtual_columns (
  table_name  text not null,
  column_name text not null,
  expression  text not null,
  primary key (table_name, column_name)
);

comment on table public.costing_virtual_columns is
  '#267: computed columns a read adds to a row. expression is SQL over the row alias t, evaluated only for a tier costing_column_tiers lets read the column. Written by migrations only.';

create table if not exists public.costing_column_bands (
  table_name  text not null,
  column_name text not null,
  bands       text[] not null,
  primary key (table_name, column_name),

  constraint costing_column_bands_bands_chk check (
    bands <@ array['sales', 'purchasing', 'management', 'technical', 'finance', 'super_admin_only']::text[]
  )
);

comment on table public.costing_column_bands is
  '#267: which write bands may change a column. column_name ''*'' covers inserting and deleting a row. A column with no row is not band-checked.';

-- Functions
-- ---------------------------------------------------------------------------
-- Identity and tier
-- ---------------------------------------------------------------------------

-- Is the caller on a signer list? A deleted employee is on none.
create or replace function public.costing_on_list(p_list_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.costing_signer_lists l
    join public.employees e on e.id = l.employee_id
    where l.list_key = p_list_key
      and l.employee_id = public.get_employee_id()
      and not coalesce(e.is_deleted, false)
  )
$$;

-- The caller's read tier on an SOR, first match wins (resolved here, never passed
-- in): closed_book (Super Admin or the Final Acquire list), cost (Purchasing
-- access), price (Deal Team or the flow's Always sees), participant (a Stage
-- Participant with an open window), else null.
create or replace function public.costing_tier(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.sales_opportunities o where o.id = p_opportunity_id) then null
    when coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire') then 'closed_book'
    when public.has_purchasing_access() then 'cost'
    when exists (
      select 1 from public.sales_opportunities o
      where o.id = p_opportunity_id
        and (
          public.sor_is_deal_team(o, public.get_employee_id())
          or public.sor_always_sees(o, public.get_employee_id())
        )
    ) then 'price'
    when exists (
      select 1 from public.sor_stage_participants p
      where p.opportunity_id = p_opportunity_id
        and p.employee_id = public.get_employee_id()
        and p.closed_at is null
    ) then 'participant'
    else null
  end
$$;

create or replace function public.costing_can_read(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.costing_tier(p_opportunity_id) is not null
$$;

-- Who may do work for a Technical evaluator. #271 widens this to members of the
-- SOR's Evaluation of Specification group task.
create or replace function public.costing_is_technical(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_purchasing_access()
$$;

-- Is the caller in a write band on this SOR? Super Admins pass sales,
-- purchasing and technical, never management.
create or replace function public.costing_in_band(p_opportunity_id uuid, p_band text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_band
    when 'sales' then
      coalesce(public.is_super_admin(), false)
      or exists (
        select 1 from public.sales_opportunities o
        where o.id = p_opportunity_id and public.sor_is_deal_team(o, public.get_employee_id())
      )
    when 'purchasing' then coalesce(public.is_super_admin(), false) or public.has_purchasing_access()
    when 'management' then public.costing_on_list('final_acquire')
    when 'technical' then coalesce(public.is_super_admin(), false) or public.costing_is_technical(p_opportunity_id)
    when 'finance' then public.has_finance_access() or public.costing_on_list('final_acquire')
    when 'super_admin_only' then coalesce(public.is_super_admin(), false)
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- Finding a row's matrix
-- ---------------------------------------------------------------------------

-- The matrix a row belongs to, walking costing_tables up through parents.
-- p_row is the row as jsonb (a parent link alone is enough). Null when a parent
-- is gone.
create or replace function public.costing_matrix_of(p_table text, p_row jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_table  text := p_table;
  v_row    jsonb := p_row;
  v_def    public.costing_tables;
  v_parent jsonb;
  v_depth  integer := 0;
begin
  loop
    v_depth := v_depth + 1;
    if v_depth > 8 then
      raise exception 'costing_matrix_of: % nests too deep', p_table;
    end if;
    if v_table = 'costing_matrices' then
      return (v_row ->> 'id')::uuid;
    end if;
    select * into v_def from public.costing_tables where table_name = v_table;
    if not found then
      return null;
    end if;
    if v_def.parent_table is null then
      return (v_row ->> 'matrix_id')::uuid;
    end if;
    execute format('select to_jsonb(p) from public.%I p where p.%I = $1', v_def.parent_table, v_def.parent_key)
      into v_parent
      using (v_row ->> v_def.parent_column)::uuid;
    if v_parent is null then
      return null;
    end if;
    v_table := v_def.parent_table;
    v_row := v_parent;
  end loop;
end;
$$;

create or replace function public.costing_matrix_opp(p_matrix_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select opportunity_id from public.costing_matrices where id = p_matrix_id
$$;

-- The caller's read tier for the matrix a row belongs to.
create or replace function public.costing_row_tier(p_table text, p_row jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.costing_tier(public.costing_matrix_opp(public.costing_matrix_of(p_table, p_row)))
$$;

-- SQL text for "this row of p_table belongs to matrix $1", over alias p_alias.
create or replace function public.costing_matrix_filter(p_table text, p_alias text default 't', p_depth integer default 0)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_def public.costing_tables;
  v_inner text;
begin
  if p_table = 'costing_matrices' then
    return format('%s.id = $1', p_alias);
  end if;
  select * into v_def from public.costing_tables where table_name = p_table;
  if not found then
    raise exception 'costing_matrix_filter: % is not a costing table', p_table;
  end if;
  if v_def.parent_table is null then
    return format('%s.matrix_id = $1', p_alias);
  end if;
  v_inner := public.costing_matrix_filter(v_def.parent_table, 'p' || (p_depth + 1), p_depth + 1);
  return format(
    '%s.%I in (select %s.%I from public.%I %s where %s)',
    p_alias, v_def.parent_column, 'p' || (p_depth + 1), v_def.parent_key, v_def.parent_table, 'p' || (p_depth + 1), v_inner
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- SOR line matching (a Tender Line picked from an SOR line)
-- ---------------------------------------------------------------------------

-- The SOR line a Tender Line was picked from, as the SOR says it now: by Odoo
-- product id when it has one, else by name, preferring the line whose quantity
-- matches the snapshot (the way purchase_request_item_lines matches).
create or replace function public.costing_matching_sor_line(p_tender_line_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select sl.id
  from public.costing_tender_lines l
  join public.costing_matrices m on m.id = l.matrix_id
  join public.sales_opportunity_items sl on sl.opportunity_id = m.opportunity_id
  where l.id = p_tender_line_id
    and l.source = 'sor_line'
    and case
      when l.odoo_product_id is not null then sl.odoo_product_id = l.odoo_product_id
      else lower(btrim(sl.product_name)) = lower(btrim(l.sor_line_snapshot ->> 'name'))
    end
  order by (sl.quantity = (l.sor_line_snapshot ->> 'quantity')::numeric) desc, sl.sort_order, sl.created_at
  limit 1
$$;

-- What the SOR line says now: {found, name, quantity, unit, odoo_product_id}, or
-- null for a typed Tender Line. {found: false} when the line is gone.
create or replace function public.costing_sor_line_now(p_tender_line_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when l.source <> 'sor_line' then null
    when sl.id is null then jsonb_build_object('found', false)
    else jsonb_build_object(
      'found', true,
      'name', sl.product_name,
      'quantity', sl.quantity,
      'unit', nullif(btrim(sl.unit), ''),
      'odoo_product_id', sl.odoo_product_id
    )
  end
  from public.costing_tender_lines l
  left join public.sales_opportunity_items sl on sl.id = public.costing_matching_sor_line(l.id)
  where l.id = p_tender_line_id
$$;

-- The quotation's price for the matched SOR line, per unit. Money: only the
-- tiers costing_column_tiers lists for it receive it.
create or replace function public.costing_quotation_price_unit(p_tender_line_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select sl.unit_price
  from public.sales_opportunity_items sl
  where sl.id = public.costing_matching_sor_line(p_tender_line_id)
$$;

-- ---------------------------------------------------------------------------
-- Tiered reads
-- ---------------------------------------------------------------------------

-- A row of jsonb cut down to the keys in p_cols.
create or replace function public.costing_pick(p_row jsonb, p_cols text[])
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from jsonb_each(coalesce(p_row, '{}'::jsonb)) e
  where e.key = any (p_cols)
$$;

-- The matrix and its rows for the caller's tier. Null when the caller has no tier
-- or the SOR has no matrix. A table the tier may read no column of is absent; a
-- column the tier may not read is absent from every row, never null.
-- Shape: {tier, matrix_id, bands: [the caller's write bands], tables: {table_name: [row, ...]}}.
create or replace function public.costing_matrix_read(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier   text := public.costing_tier(p_opportunity_id);
  v_matrix uuid;
  v_def    public.costing_tables;
  v_cols   text[];
  v_virtual text;
  v_rows   jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_bands  text[];
begin
  if v_tier is null then
    return null;
  end if;
  select id into v_matrix from public.costing_matrices where opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return null;
  end if;

  for v_def in select * from public.costing_tables order by table_name loop
    select coalesce(array_agg(c.column_name), '{}') into v_cols
    from public.costing_column_tiers c
    where c.table_name = v_def.table_name and c.column_name <> '*' and v_tier = any (c.tiers);
    if cardinality(v_cols) = 0 then
      continue;
    end if;

    -- Computed columns, only those this tier may read.
    select coalesce(string_agg(format('%L, %s', vc.column_name, vc.expression), ', '), '') into v_virtual
    from public.costing_virtual_columns vc
    where vc.table_name = v_def.table_name and vc.column_name = any (v_cols);

    execute format(
      'select coalesce(jsonb_agg(public.costing_pick(to_jsonb(t) %s, $2) order by %s), ''[]''::jsonb) from public.%I t where %s',
      case when v_virtual = '' then '' else '|| jsonb_build_object(' || v_virtual || ')' end,
      v_def.order_by,
      v_def.table_name,
      public.costing_matrix_filter(v_def.table_name)
    ) into v_rows using v_matrix, v_cols;

    v_tables := v_tables || jsonb_build_object(v_def.table_name, v_rows);
  end loop;

  -- The write bands the caller is in, so the screen can show a cell read-only.
  select coalesce(array_agg(b), '{}') into v_bands
    from unnest(array['sales', 'purchasing', 'management', 'technical', 'finance', 'super_admin_only']) b
   where public.costing_in_band(p_opportunity_id, b);

  return jsonb_build_object('tier', v_tier, 'matrix_id', v_matrix, 'bands', to_jsonb(v_bands), 'tables', v_tables);
end;
$$;

-- The matrix's history for the caller's tier, newest first. A change shows only to
-- a tier that may read the changed column; an add or a remove shows only the
-- columns the tier may read, and only to a tier that may read some column of the
-- table. Optional filters: one table, one row, a row limit.
create or replace function public.costing_history(
  p_opportunity_id uuid,
  p_table text default null,
  p_row uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier   text := public.costing_tier(p_opportunity_id);
  v_matrix uuid;
  v_result jsonb;
begin
  if v_tier is null then
    return null;
  end if;
  select id into v_matrix from public.costing_matrices where opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return null;
  end if;

  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id), '[]'::jsonb) into v_result
  from (
    select e.id, e.created_at,
      jsonb_build_object(
        'id', e.id,
        'at', e.created_at,
        'actor_id', e.actor_id,
        'kind', e.kind,
        'detail', case
          when e.detail ? 'column' then e.detail
          else jsonb_build_object('table', e.detail -> 'table', 'row', e.detail -> 'row')
            || jsonb_build_object('values', public.costing_pick(
              e.detail -> 'values',
              (select coalesce(array_agg(c.column_name), '{}') from public.costing_column_tiers c
                where c.table_name = e.detail ->> 'table' and c.column_name <> '*' and v_tier = any (c.tiers))
            ))
        end
      ) as item
    from public.costing_events e
    where e.matrix_id = v_matrix
      and (p_table is null or e.detail ->> 'table' = p_table)
      and (p_row is null or e.detail ->> 'row' = p_row::text)
      and (
        case
          when e.detail ? 'column' then exists (
            select 1 from public.costing_column_tiers c
            where c.table_name = e.detail ->> 'table' and c.column_name = e.detail ->> 'column' and v_tier = any (c.tiers)
          )
          else exists (
            select 1 from public.costing_column_tiers c
            where c.table_name = e.detail ->> 'table' and c.column_name <> '*' and v_tier = any (c.tiers)
          )
        end
      )
    order by e.created_at desc, e.id
    limit greatest(coalesce(p_limit, 100), 1)
  ) x;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Band enforcement and history writing
-- ---------------------------------------------------------------------------

-- One trigger for every costing table. UPDATE checks each registered column whose
-- value changed; INSERT checks '*' and each registered column given a value;
-- DELETE checks '*'. A refusal names the table, the column and the bands:
--   costing_band:<table>.<column>:<band,band>
-- Service role and sessions with no signed-in user (migrations, tests) pass, as
-- does a SECURITY DEFINER function that sets costing.bypass for its own writes.
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
      when tg_op = 'INSERT' then (v_new -> v_band.column_name) is not null and (v_new -> v_band.column_name) <> 'null'::jsonb
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

-- One event per changed column on an update; one event for an add or a remove,
-- carrying the row's non-null values. Written by the trigger, as the signed-in
-- employee (null for a migration or the service role).
create or replace function public.costing_write_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new    jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row    jsonb := coalesce(v_new, v_old);
  v_def    public.costing_tables;
  v_matrix uuid;
  v_key    text;
  k        text;
begin
  select * into v_def from public.costing_tables where table_name = tg_table_name;
  if not found then
    return null;
  end if;
  v_matrix := public.costing_matrix_of(tg_table_name, v_row);
  if v_matrix is null or not exists (select 1 from public.costing_matrices where id = v_matrix) then
    return null;
  end if;
  v_key := v_row ->> v_def.key_column;

  if tg_op = 'UPDATE' then
    for k in select e.key from jsonb_each(v_new) e where e.key not in ('updated_at') loop
      if (v_new -> k) is distinct from (v_old -> k) then
        insert into public.costing_events (matrix_id, actor_id, kind, detail)
        values (v_matrix, public.get_employee_id(), 'changed', jsonb_build_object(
          'table', tg_table_name, 'row', v_key, 'column', k, 'old', v_old -> k, 'new', v_new -> k
        ));
      end if;
    end loop;
  else
    insert into public.costing_events (matrix_id, actor_id, kind, detail)
    values (
      v_matrix,
      public.get_employee_id(),
      case when tg_op = 'INSERT' then 'added' else 'removed' end,
      jsonb_build_object(
        'table', tg_table_name,
        'row', v_key,
        'values', (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                   from jsonb_each(v_row) e
                   where e.value <> 'null'::jsonb and e.key not in ('created_at', 'updated_at'))
      )
    );
  end if;
  return null;
end;
$$;

create or replace function public.costing_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'costing_events is append-only: history can''t be changed (% refused)', tg_op
    using errcode = '42501';
end;
$$;

create or replace function public.costing_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- A Tender Line takes its prices with it, so the removal is in the history with
-- the Final Offer it had (the cascade alone would delete them after the line,
-- when the matrix can no longer be found).
create or replace function public.costing_tender_lines_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.costing_tender_line_prices where tender_line_id = old.id;
  return old;
end;
$$;

revoke all on function public.costing_enforce_bands() from public, anon, authenticated;
revoke all on function public.costing_write_events() from public, anon, authenticated;
revoke all on function public.costing_events_append_only() from public, anon, authenticated;
revoke all on function public.costing_touch_updated_at() from public, anon, authenticated;
revoke all on function public.costing_tender_lines_cleanup() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['costing_matrices', 'costing_matrix_money', 'costing_tender_lines', 'costing_tender_line_prices'] loop
    execute format('drop trigger if exists costing_bands on public.%I', t);
    execute format('create trigger costing_bands before insert or update or delete on public.%I for each row execute function public.costing_enforce_bands()', t);
    execute format('drop trigger if exists costing_events_write on public.%I', t);
    execute format('create trigger costing_events_write after insert or update or delete on public.%I for each row execute function public.costing_write_events()', t);
  end loop;
end;
$$;

drop trigger if exists costing_matrices_touch on public.costing_matrices;
create trigger costing_matrices_touch before update on public.costing_matrices
  for each row execute function public.costing_touch_updated_at();

drop trigger if exists costing_matrix_money_touch on public.costing_matrix_money;
create trigger costing_matrix_money_touch before update on public.costing_matrix_money
  for each row execute function public.costing_touch_updated_at();

drop trigger if exists costing_tender_lines_cleanup on public.costing_tender_lines;
create trigger costing_tender_lines_cleanup before delete on public.costing_tender_lines
  for each row execute function public.costing_tender_lines_cleanup();

drop trigger if exists costing_events_no_change on public.costing_events;
create trigger costing_events_no_change before update or delete on public.costing_events
  for each row execute function public.costing_events_append_only();

drop trigger if exists costing_events_no_truncate on public.costing_events;
create trigger costing_events_no_truncate before truncate on public.costing_events
  for each statement execute function public.costing_events_append_only();

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Creates the SOR's Costing Matrix and its money row. Idempotent: a second call
-- creates none and fills only what is still empty (the incharges). Returns the
-- matrix id. Not granted to authenticated: #462 decides who runs it (the Stage
-- Action); until then the service role does.
create or replace function public.costing_open_matrix(p_opportunity_id uuid, p_config jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_sales uuid := nullif(p_config ->> 'sales_incharge_id', '')::uuid;
  v_buyer uuid := nullif(p_config ->> 'purchasing_incharge_id', '')::uuid;
begin
  if not exists (select 1 from public.sales_opportunities where id = p_opportunity_id) then
    raise exception 'costing_open_matrix: SOR not found' using errcode = 'P0002';
  end if;

  perform set_config('costing.bypass', 'on', true);

  insert into public.costing_matrices (opportunity_id, sales_incharge_id, purchasing_incharge_id)
  values (p_opportunity_id, v_sales, v_buyer)
  on conflict (opportunity_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.costing_matrices where opportunity_id = p_opportunity_id;
    update public.costing_matrices
       set sales_incharge_id = coalesce(sales_incharge_id, v_sales),
           purchasing_incharge_id = coalesce(purchasing_incharge_id, v_buyer)
     where id = v_id
       and ((sales_incharge_id is null and v_sales is not null)
         or (purchasing_incharge_id is null and v_buyer is not null));
  end if;

  insert into public.costing_matrix_money (matrix_id) values (v_id) on conflict (matrix_id) do nothing;

  perform set_config('costing.bypass', 'off', true);
  return v_id;
end;
$$;

-- The one way to write a money table. The caller usually cannot select the row,
-- so this runs as the owner and applies the patch under the caller's own login:
-- the band trigger judges it with the real auth.uid(). Only columns that have a
-- band row can be patched. A null value clears the column. Updates the row; if it
-- does not exist yet, inserts it. Returns nothing (no leak through RETURNING).
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

  v_matrix := public.costing_matrix_of(p_table, jsonb_build_object(v_def.key_column, p_row));
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

  if v_count = 0 then
    execute format(
      'insert into public.%I (%I, %s) select $2, %s from jsonb_populate_record(null::public.%I, $1) r',
      p_table, v_def.key_column, v_cols,
      (select string_agg(format('r.%I', k), ', ') from jsonb_object_keys(p_patch) k),
      p_table
    ) using p_patch, p_row;
  end if;
end;
$$;

-- Puts the matrix's Tender Lines in the given order (1, 2, ... in the list's
-- order). The list must name every Tender Line of the matrix. Each change still
-- passes the band trigger.
create or replace function public.costing_reorder_tender_lines(p_matrix_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp uuid := public.costing_matrix_opp(p_matrix_id);
  i     integer;
begin
  if v_opp is null then
    raise exception 'costing_reorder_tender_lines: not found' using errcode = 'P0002';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_reorder_tender_lines: not allowed' using errcode = '42501';
  end if;
  if (select count(*) from public.costing_tender_lines where matrix_id = p_matrix_id) <> coalesce(cardinality(p_ids), 0)
     or exists (
       select 1 from unnest(p_ids) u(id)
       where not exists (select 1 from public.costing_tender_lines l where l.id = u.id and l.matrix_id = p_matrix_id)
     )
     or (select count(distinct id) from unnest(p_ids) u(id)) <> coalesce(cardinality(p_ids), 0) then
    raise exception 'costing_reorder_tender_lines: the list must name each Tender Line once' using errcode = '22023';
  end if;
  for i in 1 .. coalesce(cardinality(p_ids), 0) loop
    update public.costing_tender_lines set position = i
     where id = p_ids[i] and matrix_id = p_matrix_id and position is distinct from i;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.costing_matrices enable row level security;
alter table public.costing_matrix_money enable row level security;
alter table public.costing_tender_lines enable row level security;
alter table public.costing_tender_line_prices enable row level security;
alter table public.costing_events enable row level security;
alter table public.costing_signer_lists enable row level security;
alter table public.costing_tables enable row level security;
alter table public.costing_column_tiers enable row level security;
alter table public.costing_virtual_columns enable row level security;
alter table public.costing_column_bands enable row level security;

revoke all on table public.costing_matrices, public.costing_matrix_money, public.costing_tender_lines,
  public.costing_tender_line_prices, public.costing_events, public.costing_signer_lists,
  public.costing_tables, public.costing_column_tiers, public.costing_virtual_columns,
  public.costing_column_bands from anon, authenticated;

grant select, update on public.costing_matrices to authenticated;
grant select on public.costing_matrix_money to authenticated;
grant select, insert, update, delete on public.costing_tender_lines to authenticated;
grant select on public.costing_tender_line_prices to authenticated;
grant select on public.costing_events to authenticated;
grant select, insert, delete on public.costing_signer_lists to authenticated;
grant select on public.costing_tables, public.costing_column_tiers, public.costing_virtual_columns,
  public.costing_column_bands to authenticated;

-- Non-money tables: anyone with a tier on the SOR. The band trigger decides who
-- may write which column.
drop policy if exists costing_matrices_read on public.costing_matrices;
create policy costing_matrices_read on public.costing_matrices
  for select to authenticated using (public.costing_can_read(opportunity_id));

drop policy if exists costing_matrices_update on public.costing_matrices;
create policy costing_matrices_update on public.costing_matrices
  for update to authenticated
  using (public.costing_can_read(opportunity_id))
  with check (public.costing_can_read(opportunity_id));

drop policy if exists costing_tender_lines_read on public.costing_tender_lines;
create policy costing_tender_lines_read on public.costing_tender_lines
  for select to authenticated using (public.costing_can_read(public.costing_matrix_opp(matrix_id)));

drop policy if exists costing_tender_lines_insert on public.costing_tender_lines;
create policy costing_tender_lines_insert on public.costing_tender_lines
  for insert to authenticated with check (public.costing_can_read(public.costing_matrix_opp(matrix_id)));

drop policy if exists costing_tender_lines_update on public.costing_tender_lines;
create policy costing_tender_lines_update on public.costing_tender_lines
  for update to authenticated
  using (public.costing_can_read(public.costing_matrix_opp(matrix_id)))
  with check (public.costing_can_read(public.costing_matrix_opp(matrix_id)));

drop policy if exists costing_tender_lines_delete on public.costing_tender_lines;
create policy costing_tender_lines_delete on public.costing_tender_lines
  for delete to authenticated using (public.costing_can_read(public.costing_matrix_opp(matrix_id)));

-- Money tables and money events: the closed_book tier only. Everyone else reads
-- them through costing_matrix_read / costing_history.
drop policy if exists costing_matrix_money_read on public.costing_matrix_money;
create policy costing_matrix_money_read on public.costing_matrix_money
  for select to authenticated
  using (public.costing_tier(public.costing_matrix_opp(matrix_id)) = 'closed_book');

drop policy if exists costing_tender_line_prices_read on public.costing_tender_line_prices;
create policy costing_tender_line_prices_read on public.costing_tender_line_prices
  for select to authenticated
  using (public.costing_row_tier('costing_tender_line_prices', jsonb_build_object('tender_line_id', tender_line_id)) = 'closed_book');

drop policy if exists costing_events_read on public.costing_events;
create policy costing_events_read on public.costing_events
  for select to authenticated
  using (public.costing_tier(public.costing_matrix_opp(matrix_id)) = 'closed_book');

-- Signer lists: Super Admins read and edit; a member reads their own rows.
drop policy if exists costing_signer_lists_read on public.costing_signer_lists;
create policy costing_signer_lists_read on public.costing_signer_lists
  for select to authenticated
  using (coalesce(public.is_super_admin(), false) or employee_id = public.get_employee_id());

drop policy if exists costing_signer_lists_insert on public.costing_signer_lists;
create policy costing_signer_lists_insert on public.costing_signer_lists
  for insert to authenticated with check (coalesce(public.is_super_admin(), false));

drop policy if exists costing_signer_lists_delete on public.costing_signer_lists;
create policy costing_signer_lists_delete on public.costing_signer_lists
  for delete to authenticated using (coalesce(public.is_super_admin(), false));

-- The registries are plain configuration: any signed-in employee may read them.
drop policy if exists costing_tables_read on public.costing_tables;
create policy costing_tables_read on public.costing_tables for select to authenticated using (true);
drop policy if exists costing_column_tiers_read on public.costing_column_tiers;
create policy costing_column_tiers_read on public.costing_column_tiers for select to authenticated using (true);
drop policy if exists costing_virtual_columns_read on public.costing_virtual_columns;
create policy costing_virtual_columns_read on public.costing_virtual_columns for select to authenticated using (true);
drop policy if exists costing_column_bands_read on public.costing_column_bands;
create policy costing_column_bands_read on public.costing_column_bands for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.costing_on_list(text) from public, anon;
grant execute on function public.costing_on_list(text) to authenticated;
revoke all on function public.costing_tier(uuid) from public, anon;
grant execute on function public.costing_tier(uuid) to authenticated;
revoke all on function public.costing_can_read(uuid) from public, anon;
grant execute on function public.costing_can_read(uuid) to authenticated;
revoke all on function public.costing_is_technical(uuid) from public, anon;
grant execute on function public.costing_is_technical(uuid) to authenticated;
revoke all on function public.costing_in_band(uuid, text) from public, anon;
grant execute on function public.costing_in_band(uuid, text) to authenticated;
revoke all on function public.costing_matrix_read(uuid) from public, anon;
grant execute on function public.costing_matrix_read(uuid) to authenticated;
revoke all on function public.costing_history(uuid, text, uuid, integer) from public, anon;
grant execute on function public.costing_history(uuid, text, uuid, integer) to authenticated;
revoke all on function public.costing_set_money(text, uuid, jsonb) from public, anon;
grant execute on function public.costing_set_money(text, uuid, jsonb) to authenticated;
revoke all on function public.costing_reorder_tender_lines(uuid, uuid[]) from public, anon;
grant execute on function public.costing_reorder_tender_lines(uuid, uuid[]) to authenticated;

-- Internal: policies and the registries' dynamic SQL call these as the owner.
-- Policies run as the caller, so the ones a policy calls keep authenticated.
revoke all on function public.costing_matrix_of(text, jsonb) from public, anon;
grant execute on function public.costing_matrix_of(text, jsonb) to authenticated;
revoke all on function public.costing_matrix_opp(uuid) from public, anon;
grant execute on function public.costing_matrix_opp(uuid) to authenticated;
revoke all on function public.costing_row_tier(text, jsonb) from public, anon;
grant execute on function public.costing_row_tier(text, jsonb) to authenticated;
revoke all on function public.costing_matrix_filter(text, text, integer) from public, anon, authenticated;
revoke all on function public.costing_matching_sor_line(uuid) from public, anon, authenticated;
revoke all on function public.costing_sor_line_now(uuid) from public, anon, authenticated;
revoke all on function public.costing_quotation_price_unit(uuid) from public, anon, authenticated;
revoke all on function public.costing_pick(jsonb, text[]) from public, anon, authenticated;
-- Not granted to authenticated until #462 decides who runs it.
revoke all on function public.costing_open_matrix(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.costing_open_matrix(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Registry rows for this ticket's tables and columns
-- ---------------------------------------------------------------------------

insert into public.costing_tables (table_name, parent_table, parent_column, parent_key, key_column, order_by, money) values
  ('costing_matrices', null, null, 'id', 'id', 't.created_at', false),
  ('costing_matrix_money', null, null, 'id', 'matrix_id', 't.matrix_id', true),
  ('costing_tender_lines', null, null, 'id', 'id', 't.position, t.created_at', false)
on conflict (table_name) do update
  set parent_table = excluded.parent_table, parent_column = excluded.parent_column,
      parent_key = excluded.parent_key, key_column = excluded.key_column,
      order_by = excluded.order_by, money = excluded.money;

insert into public.costing_tables (table_name, parent_table, parent_column, parent_key, key_column, order_by, money) values
  ('costing_tender_line_prices', 'costing_tender_lines', 'tender_line_id', 'id', 'tender_line_id', 't.tender_line_id', true)
on conflict (table_name) do update
  set parent_table = excluded.parent_table, parent_column = excluded.parent_column,
      parent_key = excluded.parent_key, key_column = excluded.key_column,
      order_by = excluded.order_by, money = excluded.money;

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_matrices', 'id', '{participant,price,cost,closed_book}'),
  ('costing_matrices', 'opportunity_id', '{participant,price,cost,closed_book}'),
  ('costing_matrices', 'sales_incharge_id', '{participant,price,cost,closed_book}'),
  ('costing_matrices', 'purchasing_incharge_id', '{participant,price,cost,closed_book}'),
  ('costing_matrices', 'bid_submitted_at', '{participant,price,cost,closed_book}'),
  ('costing_matrices', 'created_at', '{participant,price,cost,closed_book}'),
  ('costing_matrices', 'updated_at', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'id', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'matrix_id', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'position', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'tender_specification', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'unit', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'quantity', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'source', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'sor_item_id', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'odoo_product_id', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'sor_line_snapshot', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'sor_line_now', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'created_by', '{participant,price,cost,closed_book}'),
  ('costing_tender_lines', 'created_at', '{participant,price,cost,closed_book}'),
  -- ABC is the client's public ceiling; Purchasing costs against it and, without
  -- Final Offer, cannot work out the margin from it.
  ('costing_tender_line_prices', 'tender_line_id', '{price,cost,closed_book}'),
  ('costing_tender_line_prices', 'abc_unit', '{price,cost,closed_book}'),
  ('costing_tender_line_prices', 'final_offer_unit', '{price,closed_book}'),
  ('costing_tender_line_prices', 'quotation_price_unit', '{price,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_virtual_columns (table_name, column_name, expression) values
  ('costing_tender_lines', 'sor_line_now', 'public.costing_sor_line_now(t.id)'),
  ('costing_tender_line_prices', 'quotation_price_unit', 'public.costing_quotation_price_unit(t.tender_line_id)')
on conflict (table_name, column_name) do update set expression = excluded.expression;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_matrices', '*', '{super_admin_only}'),
  ('costing_matrices', 'opportunity_id', '{super_admin_only}'),
  ('costing_matrices', 'sales_incharge_id', '{sales}'),
  ('costing_matrices', 'purchasing_incharge_id', '{purchasing}'),
  ('costing_matrices', 'bid_submitted_at', '{super_admin_only}'),
  ('costing_matrix_money', '*', '{super_admin_only}'),
  ('costing_tender_lines', '*', '{sales}'),
  ('costing_tender_lines', 'position', '{sales}'),
  ('costing_tender_lines', 'tender_specification', '{sales}'),
  ('costing_tender_lines', 'unit', '{sales}'),
  ('costing_tender_lines', 'quantity', '{sales}'),
  ('costing_tender_lines', 'source', '{sales}'),
  ('costing_tender_lines', 'sor_item_id', '{sales}'),
  ('costing_tender_lines', 'odoo_product_id', '{sales}'),
  ('costing_tender_lines', 'sor_line_snapshot', '{sales}'),
  ('costing_tender_lines', 'created_by', '{sales}'),
  ('costing_tender_line_prices', '*', '{sales}'),
  ('costing_tender_line_prices', 'abc_unit', '{sales}'),
  ('costing_tender_line_prices', 'final_offer_unit', '{sales}')
on conflict (table_name, column_name) do update set bands = excluded.bands;
