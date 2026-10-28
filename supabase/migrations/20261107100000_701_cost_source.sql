-- #701 (spec #699): a Costing row's cost fills itself, and says where it came from.
--
-- Order: the Canvass winner, then the P0 price (p0_unit_price), then Odoo's standard_price, then typed.
-- A typed cost is never replaced by a later fill (the acquire_from_offer_id rule, for every source).
--
--   costing_component_costs.acquire_source   'canvass' | 'odoo' | 'typed', null while Acquire is blank.
--                                            The P0 price is its own column, so 'P0' is read from p0_unit_price.
--
-- Same audience as acquire_from_offer_id (cost and closed_book tiers, Purchasing band): the price side
-- is never sent it.

alter table public.costing_component_costs
  add column if not exists acquire_source text;

alter table public.costing_component_costs
  drop constraint if exists costing_component_costs_acquire_source_chk;
alter table public.costing_component_costs
  add constraint costing_component_costs_acquire_source_chk check (acquire_source in ('canvass', 'odoo', 'typed'));

comment on column public.costing_component_costs.acquire_source is
  '#701: where Acquire came from: canvass (winning Offer), odoo (standard_price) or typed. Null while Acquire is blank.';

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_component_costs', 'acquire_source', '{cost,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_component_costs', 'acquire_source', '{purchasing}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

-- Rows already costed: a Canvass-backed one is canvass, one equal to Odoo's cost is odoo, the rest were typed.
update public.costing_component_costs
   set acquire_source = case
         when acquire_from_offer_id is not null then 'canvass'
         when odoo_unit is not null and acquire_unit = odoo_unit then 'odoo'
         else 'typed'
       end
 where acquire_unit is not null and acquire_source is null;

-- ---------------------------------------------------------------------------
-- The source follows the write
-- ---------------------------------------------------------------------------

-- A fill from Odoo sets the transaction-local flag costing.fill_source = 'odoo'. A Canvass fill leaves
-- acquire_from_offer_id set. Any other change to Acquire is typed. Named to fire after
-- trg_canvass_null_fill_mark, which clears the Canvass mark on a typed change.
create or replace function public.costing_set_acquire_source()
returns trigger
language plpgsql
as $$
begin
  if new.acquire_unit is null then
    new.acquire_source := null;
  elsif new.acquire_from_offer_id is not null then
    new.acquire_source := 'canvass';
  elsif tg_op = 'INSERT'
        or new.acquire_unit is distinct from old.acquire_unit
        or new.acquire_source is null
        or new.acquire_source = 'canvass' then
    -- Typed, unless Odoo is filling; a figure whose Canvass claim was dropped is now typed.
    new.acquire_source := case when coalesce(current_setting('costing.fill_source', true), '') = 'odoo' then 'odoo' else 'typed' end;
  end if;
  return new;
end
$$;

drop trigger if exists trg_costing_acquire_source on public.costing_component_costs;
create trigger trg_costing_acquire_source
  before insert or update on public.costing_component_costs
  for each row execute function public.costing_set_acquire_source();

-- The Odoo fill marks its writes, and still never replaces a cost that is there.
create or replace function public.costing_fill_odoo_costs(p_actor uuid, p_opportunity_id uuid, p_costs jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_target record;
  v_cost   numeric;
  v_filled integer := 0;
begin
  if not public.costing_actor_can_fill(p_opportunity_id, p_actor) then
    raise exception 'costing_fill: only Sales or Purchasing can fill the matrix from Odoo' using errcode = '42501';
  end if;
  perform set_config('costing.fill_source', 'odoo', true);
  for v_target in select * from public.costing_odoo_cost_targets(p_actor, p_opportunity_id) loop
    v_cost := nullif(p_costs ->> v_target.odoo_product_id::text, '')::numeric;
    if v_cost is null or v_cost <= 0 then
      continue;
    end if;
    v_cost := round(v_cost, 2);
    insert into public.costing_component_costs (component_id, odoo_unit, acquire_unit)
    values (v_target.component_id, v_cost, v_cost)
    on conflict (component_id) do update
      set odoo_unit = coalesce(public.costing_component_costs.odoo_unit, excluded.odoo_unit),
          acquire_unit = coalesce(public.costing_component_costs.acquire_unit, excluded.acquire_unit);
    v_filled := v_filled + 1;
  end loop;
  perform set_config('costing.fill_source', '', true);
  return v_filled;
end;
$function$;

-- ---------------------------------------------------------------------------
-- A Canvass winner outranks an Odoo fill (it still never replaces a typed cost)
-- ---------------------------------------------------------------------------

do $$
declare
  v_old text := pg_get_functiondef('public.canvass_apply_winner(uuid,uuid)'::regprocedure);
  v_new text;
begin
  v_new := replace(
    v_old,
    'if v_cost.acquire_from_offer_id is not null or v_cost.acquire_unit is null then',
    'if v_cost.acquire_from_offer_id is not null or v_cost.acquire_unit is null or v_cost.acquire_source = ''odoo'' then'
  );
  if v_new = v_old then
    raise exception '#701: canvass_apply_winner no longer has the line this migration rewrites';
  end if;
  execute v_new;
end
$$;

-- ---------------------------------------------------------------------------
-- "Costing priced": a P0 price is a cost too
-- ---------------------------------------------------------------------------

do $$
declare
  v_old text := pg_get_functiondef('public.costing_condition_inputs(uuid)'::regprocedure);
  v_new text;
begin
  v_new := replace(
    v_old,
    'count(*) filter (where cc.acquire_unit is null)',
    'count(*) filter (where cc.acquire_unit is null and cc.p0_unit_price is null)'
  );
  if v_new = v_old then
    raise exception '#701: costing_condition_inputs no longer has the line this migration rewrites';
  end if;
  execute v_new;
end
$$;
