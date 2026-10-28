-- #723 (spec #718): the S0 Evaluation's cost guide.
--   * costing_cost_categories: the sheet's cost categories with a low and high % (seeded from the
--     project sheet's DASHBOARD tab). Any signed-in employee reads them; only Super Admins change the
--     ranges (the key and label are fixed).
--   * costing_cost_rows.category_key: a cost-only row's category. Required on a new row (the add function
--     refuses without one); an old row may stay blank and counts as "Uncategorised". Once a row has a
--     category it cannot be blanked again.
--   * costing_cost_guide(opportunity): each category's share of the Final Offer total next to its range.
--     Served only to a tier that reads BOTH the Final Offer and Final Acquire columns (registry-driven, so
--     it follows those columns if they ever move); every other caller gets null. Product rows (Components)
--     count as Products. A share outside its range is reported as a warning status; nothing is blocked.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.costing_cost_categories (
  key        text primary key,
  label      text not null,
  low_pct    numeric(5,2) not null,
  high_pct   numeric(5,2) not null,
  sort       integer not null default 0,
  updated_at timestamptz not null default now(),

  constraint costing_cost_categories_key_chk check (key ~ '^[a-z][a-z_]*$'),
  constraint costing_cost_categories_range_chk check (low_pct >= 0 and high_pct <= 100 and low_pct <= high_pct)
);

comment on table public.costing_cost_categories is
  '#723: the cost guide. One row per category of the sheet (Products, Labor, ...) with the % of the Final Offer it should take, low to high. Not secret: any signed-in employee reads it. Only Super Admins change a range; rows are never added or deleted from the app.';

insert into public.costing_cost_categories (key, label, low_pct, high_pct, sort) values
  ('products',  'Products',                           70, 80, 1),
  ('labor',     'Labor',                               8, 15, 2),
  ('logistics', 'Logistics & Transportation',          3,  7, 3),
  ('equipment', 'Equipment & Tools',                   1,  3, 4),
  ('permits',   'Permits/Insurance/Compliance',        1,  2, 5),
  ('overhead',  'Overhead',                            2,  5, 6),
  ('profit',    'Profit Margin',                       5, 10, 7)
on conflict (key) do nothing;

create or replace function public.costing_cost_categories_touch()
returns trigger
language plpgsql
as $$
begin
  -- The key, label and order are fixed; only the range moves.
  new.key = old.key;
  new.label = old.label;
  new.sort = old.sort;
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.costing_cost_categories_touch() from public, anon, authenticated;

drop trigger if exists costing_cost_categories_touch on public.costing_cost_categories;
create trigger costing_cost_categories_touch before update on public.costing_cost_categories
  for each row execute function public.costing_cost_categories_touch();

alter table public.costing_cost_categories enable row level security;

revoke all on table public.costing_cost_categories from anon, authenticated;
grant select on public.costing_cost_categories to authenticated;
grant update (low_pct, high_pct) on public.costing_cost_categories to authenticated;

drop policy if exists costing_cost_categories_read on public.costing_cost_categories;
create policy costing_cost_categories_read on public.costing_cost_categories
  for select to authenticated using (true);

drop policy if exists costing_cost_categories_update on public.costing_cost_categories;
create policy costing_cost_categories_update on public.costing_cost_categories
  for update to authenticated
  using (coalesce(public.is_super_admin(), false))
  with check (coalesce(public.is_super_admin(), false));

-- ---------------------------------------------------------------------------
-- A cost-only row's category
-- ---------------------------------------------------------------------------

alter table public.costing_cost_rows
  add column if not exists category_key text references public.costing_cost_categories (key);

comment on column public.costing_cost_rows.category_key is
  '#723: the cost guide category. Null only on a row made before the guide ("Uncategorised"); a new row must have one and a row that has one cannot lose it.';

-- Not a CHECK: an old row with no category must stay editable.
create or replace function public.costing_cost_rows_keep_category()
returns trigger
language plpgsql
as $$
begin
  if old.category_key is not null and new.category_key is null then
    raise exception 'costing_cost_row: a cost needs a category' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.costing_cost_rows_keep_category() from public, anon, authenticated;

drop trigger if exists costing_cost_rows_keep_category on public.costing_cost_rows;
create trigger costing_cost_rows_keep_category before update on public.costing_cost_rows
  for each row execute function public.costing_cost_rows_keep_category();

-- Every tier that reads the row reads its category; Sales and Purchasing write it, like the description.
insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_cost_rows', 'category_key', '{participant,price,cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_cost_rows', 'category_key', '{sales,purchasing}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

-- costing_add_cost_row (latest: 20261023210000_refusal_codes.sql): a new row names its category.
drop function if exists public.costing_add_cost_row(uuid, text, numeric);

create or replace function public.costing_add_cost_row(
  p_matrix_id    uuid,
  p_description  text default '',
  p_quantity     numeric default 1,
  p_category_key text default null
)
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
    raise exception 'costing_add_cost_row: not found' using errcode = '22023';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_add_cost_row: not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_category_key, '')), '') is null then
    raise exception 'costing_cost_row: a cost needs a category' using errcode = '22023';
  end if;
  if not exists (select 1 from public.costing_cost_categories c where c.key = p_category_key) then
    raise exception 'costing_cost_row: that category does not exist' using errcode = '22023';
  end if;
  insert into public.costing_cost_rows (matrix_id, position, description, quantity, category_key)
  values (
    p_matrix_id,
    coalesce((select max(r.position) from public.costing_cost_rows r where r.matrix_id = p_matrix_id), 0) + 1,
    coalesce(p_description, ''),
    coalesce(p_quantity, 1),
    p_category_key
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.costing_add_cost_row(uuid, text, numeric, text) from public, anon;
grant execute on function public.costing_add_cost_row(uuid, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The guide
-- ---------------------------------------------------------------------------

-- Each category's total (Final Acquire x quantity), its share of the Final Offer total, its range and
-- where the share falls ('below', 'within', 'above'). Components count as Products; a cost-only row
-- counts in its category, or "Uncategorised" when it has none. Shares are null while a Tender Line has
-- no Final Offer (a blank is never zero). A cost without a Final Acquire adds nothing and is counted in
-- missing_cost. Null for a caller whose tier does not read every column the figures come from.
create or replace function public.costing_cost_guide(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier    text := public.costing_tier(p_opportunity_id);
  v_matrix  uuid;
  v_offer   numeric;
  v_missing_offer integer;
  v_missing_cost  integer;
  v_product numeric;
  v_cats    jsonb;
  v_uncat   numeric;
begin
  if v_tier is null then
    return null;
  end if;
  -- The figures are the Final Offer and Final Acquire; the tier must be sent both.
  if exists (
    select 1
      from (values ('costing_tender_line_prices', 'final_offer_unit'),
                   ('costing_component_costs', 'final_acquire_unit'),
                   ('costing_cost_rows', 'final_acquire_unit')) need (t, c)
     where not exists (
       select 1 from public.costing_column_tiers r
        where r.table_name = need.t and r.column_name = need.c and v_tier = any (r.tiers)
     )
  ) then
    return null;
  end if;
  select id into v_matrix from public.costing_matrices where opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return null;
  end if;

  select count(*) filter (where p.final_offer_unit is null),
         sum(p.final_offer_unit * l.quantity)
    into v_missing_offer, v_offer
    from public.costing_tender_lines l
    left join public.costing_tender_line_prices p on p.tender_line_id = l.id
   where l.matrix_id = v_matrix;
  if not exists (select 1 from public.costing_tender_lines where matrix_id = v_matrix) or v_missing_offer > 0 then
    v_offer := null;
  end if;

  select coalesce(sum(cc.final_acquire_unit * c.quantity), 0),
         count(*) filter (where cc.final_acquire_unit is null)
    into v_product, v_missing_cost
    from public.costing_tender_lines l
    join public.costing_components c on c.tender_line_id = l.id
    left join public.costing_component_costs cc on cc.component_id = c.id
   where l.matrix_id = v_matrix;

  select coalesce(sum(r.final_acquire_unit * r.quantity), 0),
         v_missing_cost + count(*) filter (where r.final_acquire_unit is null)
    into v_uncat, v_missing_cost
    from public.costing_cost_rows r
   where r.matrix_id = v_matrix and r.category_key is null;

  select coalesce(jsonb_agg(entry order by sort), '[]'::jsonb) into v_cats
    from (
      select k.sort,
             jsonb_build_object(
               'key', k.key,
               'label', k.label,
               'low_pct', k.low_pct,
               'high_pct', k.high_pct,
               'total', t.total,
               'share_pct', case when v_offer is null or v_offer = 0 then null else round(t.total * 100 / v_offer, 2) end,
               'status', case
                 when v_offer is null or v_offer = 0 then null
                 when round(t.total * 100 / v_offer, 2) < k.low_pct then 'below'
                 when round(t.total * 100 / v_offer, 2) > k.high_pct then 'above'
                 else 'within'
               end
             ) as entry
        from public.costing_cost_categories k
        cross join lateral (
          select case when k.key = 'products' then v_product else 0 end
                 + coalesce((
                     select sum(r.final_acquire_unit * r.quantity)
                       from public.costing_cost_rows r
                      where r.matrix_id = v_matrix and r.category_key = k.key
                   ), 0) as total
        ) t
    ) s;

  -- Rows in a category with no Final Acquire yet.
  select v_missing_cost + count(*) into v_missing_cost
    from public.costing_cost_rows r
   where r.matrix_id = v_matrix and r.category_key is not null and r.final_acquire_unit is null;

  return jsonb_build_object(
    'final_offer_total', v_offer,
    'missing_offer', v_missing_offer,
    'missing_cost', v_missing_cost,
    'categories', v_cats,
    'uncategorised', jsonb_build_object(
      'total', v_uncat,
      'share_pct', case when v_offer is null or v_offer = 0 then null else round(v_uncat * 100 / v_offer, 2) end
    )
  );
end;
$$;

revoke all on function public.costing_cost_guide(uuid) from public, anon;
grant execute on function public.costing_cost_guide(uuid) to authenticated;
