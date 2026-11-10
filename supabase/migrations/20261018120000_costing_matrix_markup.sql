-- Costing Matrix, part 3: markup (#269, spec #266, amended by #316 and #319).
--
-- WHAT THIS ADDS
--   costing_markup_presets   the named factors the business picks from ("Government
--                            x1.35"): label, factor, sort, active. A preset is
--                            deactivated, never deleted (no delete is granted).
--   costing_matrix_money     default_factor and default_preset_id: the matrix's default
--                            markup factor, typed or taken from a preset. Setting a
--                            preset copies its factor, so editing a preset later does
--                            not move a matrix that already used it.
--   Virtual column           markup_price_unit on costing_component_costs and
--                            costing_cost_rows: Acquire x the effective factor (the
--                            row's own factor, else the matrix default; a cost-only
--                            row with no factor of its own is x1.00), rounded half up
--                            to the centavo, null while Acquire or the factor is blank.
--
--   The factor belongs to the Closed Book (#316): the default and the row overrides
--   (costing_component_costs.markup_factor, costing_cost_rows.markup_factor, registered
--   in #268) are written by the Final Acquire list (the management band) and read by the
--   closed_book tier only. Sales and Purchasing never receive a factor, so
--   "Markup Price / factor" cannot give them the Acquire. Sales reads the peso Markup
--   Price (price tier); Purchasing does not read it. Achieved markup is computed in the
--   browser from what a tier received, which only closed_book has (Final Offer and
--   Acquire together); no column of it exists.
--
--   Everything goes through #267's registries as rows: costing_column_tiers,
--   costing_column_bands, costing_virtual_columns. No generic function is rewritten.
--
-- ACCESS
--   Presets are read and written by Super Admins and the Final Acquire list only (they
--   follow the factor; the spec gave them to Purchasing before #224 was amended).
--   costing_can_manage_markup() tells the screen whether the caller is one of them.
--   The default factor is written through costing_set_money (a money table), like every
--   other money column, so the band trigger judges it with the caller's own login.
--
-- SAFE TO RUN AT ANY TIME: a new table, two new columns, new functions, policies and
-- registry rows. Idempotent.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.costing_markup_presets (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  factor     numeric(10,4) not null,
  sort       integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint costing_markup_presets_factor_chk check (factor > 0)
);

create unique index if not exists costing_markup_presets_label_key
  on public.costing_markup_presets (lower(btrim(label)));

comment on table public.costing_markup_presets is
  '#269: the named markup factors the Final Acquire list picks from. Deactivated (active = false), never deleted: a matrix that used one keeps its factor and its default_preset_id. Readable and writable by Super Admins and the Final Acquire list only.';

alter table public.costing_matrix_money
  add column if not exists default_factor numeric(10,4);

alter table public.costing_matrix_money
  add column if not exists default_preset_id uuid references public.costing_markup_presets (id);

alter table public.costing_matrix_money
  drop constraint if exists costing_matrix_money_factor_chk;

alter table public.costing_matrix_money
  add constraint costing_matrix_money_factor_chk check (default_factor is null or default_factor > 0);

comment on column public.costing_matrix_money.default_factor is
  '#269: the matrix''s default markup factor (x1.35). Null = none chosen yet: a Component with no factor of its own has no Markup Price. Written by the Final Acquire list; read by closed_book only.';

-- Functions
-- ---------------------------------------------------------------------------
-- Markup Price
-- ---------------------------------------------------------------------------

-- Acquire x factor, half up to the centavo (numeric rounds half away from zero, which
-- for these non-negative figures is half up). Null while either is blank: a missing
-- cost never becomes a free item. src/utils/costingMath.js markupPrice does the same
-- sum; the policy test (80) holds the two to the same answers.
create or replace function public.costing_markup_price(p_acquire numeric, p_factor numeric)
returns numeric
language sql
immutable
as $$
  select case when p_acquire is null or p_factor is null then null else round(p_acquire * p_factor, 2) end
$$;

-- The matrix's default factor (null when none is chosen). Internal: the virtual column
-- calls it as the owner so a tier that cannot read the factor can read the price.
create or replace function public.costing_default_factor(p_matrix_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select m.default_factor from public.costing_matrix_money m where m.matrix_id = p_matrix_id
$$;

-- A Component's Markup Price per unit: its own factor, else the matrix default.
create or replace function public.costing_component_markup_price(p_component_id uuid, p_acquire numeric, p_factor numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select public.costing_markup_price(
    p_acquire,
    coalesce(p_factor, public.costing_default_factor(
      public.costing_matrix_of('costing_component_costs', jsonb_build_object('component_id', p_component_id))
    ))
  )
$$;

-- Does the caller edit the markup presets? Super Admins and the Final Acquire list.
create or replace function public.costing_can_manage_markup()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire')
$$;

create or replace function public.costing_markup_presets_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.costing_markup_price(numeric, numeric) from public, anon, authenticated;
revoke all on function public.costing_default_factor(uuid) from public, anon, authenticated;
revoke all on function public.costing_component_markup_price(uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.costing_markup_presets_touch() from public, anon, authenticated;
revoke all on function public.costing_can_manage_markup() from public, anon;
grant execute on function public.costing_can_manage_markup() to authenticated;

drop trigger if exists costing_markup_presets_touch on public.costing_markup_presets;
create trigger costing_markup_presets_touch before update on public.costing_markup_presets
  for each row execute function public.costing_markup_presets_touch();

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.costing_markup_presets enable row level security;

revoke all on table public.costing_markup_presets from anon, authenticated;
-- No delete: a preset is deactivated.
grant select, insert, update on public.costing_markup_presets to authenticated;

drop policy if exists costing_markup_presets_read on public.costing_markup_presets;
create policy costing_markup_presets_read on public.costing_markup_presets
  for select to authenticated
  using (public.costing_can_manage_markup());

drop policy if exists costing_markup_presets_insert on public.costing_markup_presets;
create policy costing_markup_presets_insert on public.costing_markup_presets
  for insert to authenticated
  with check (public.costing_can_manage_markup());

drop policy if exists costing_markup_presets_update on public.costing_markup_presets;
create policy costing_markup_presets_update on public.costing_markup_presets
  for update to authenticated
  using (public.costing_can_manage_markup())
  with check (public.costing_can_manage_markup());

-- ---------------------------------------------------------------------------
-- Registry rows
-- ---------------------------------------------------------------------------

-- The matrix's money row is read by closed_book only, and so is the default factor.
-- (#270 adds Marketing and OPEX the same way.)
insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_matrix_money', 'matrix_id', '{closed_book}'),
  ('costing_matrix_money', 'default_factor', '{closed_book}'),
  ('costing_matrix_money', 'default_preset_id', '{closed_book}'),
  -- Sales reads the peso Markup Price (and so does the Closed Book); Purchasing does not.
  ('costing_component_costs', 'markup_price_unit', '{price,closed_book}'),
  ('costing_cost_rows', 'markup_price_unit', '{price,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_virtual_columns (table_name, column_name, expression) values
  ('costing_component_costs', 'markup_price_unit',
   'public.costing_component_markup_price(t.component_id, t.acquire_unit, t.markup_factor)'),
  -- A cost-only row with no factor of its own is x1.00, not the matrix default.
  ('costing_cost_rows', 'markup_price_unit',
   'public.costing_markup_price(t.acquire_unit, coalesce(t.markup_factor, 1.00))')
on conflict (table_name, column_name) do update set expression = excluded.expression;

-- The default factor and its preset are the Final Acquire list's, like the row overrides.
insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_matrix_money', 'default_factor', '{management}'),
  ('costing_matrix_money', 'default_preset_id', '{management}')
on conflict (table_name, column_name) do update set bands = excluded.bands;
