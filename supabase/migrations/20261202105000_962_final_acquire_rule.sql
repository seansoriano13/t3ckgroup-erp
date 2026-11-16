-- #962 (spec #955, decision 3): Final Acquire is back, and it is filled by a rule.
--
--   Status Stockable   Final Acquire = Odoo SRP x (1 + percent / 100)
--   Status Source Out  Final Acquire = the line's Acquire (the attached P0's price when there is one), no percent
--   No Status yet      blank
--
-- The percent is the evaluation's default (costing_matrix_money.final_acquire_percent, starting at -20) unless
-- the line carries its own (costing_component_costs.final_acquire_percent). Both are Closed Book tier and
-- written by the decider list (the 'management' band).
--
-- A decider may type a line's Final Acquire over the rule: that value is marked typed (final_acquire_typed),
-- wins over the rule and never moves. Writing the cell blank puts the line back on the rule.
-- A rule-filled value is worked again whenever the SRP, the percent, the Status, the Acquire or the P0 price
-- changes. src/utils/costingMath.js finalAcquireByRule does the same sum; policy test 962 holds the two together.
--
-- WHAT CHANGES
--   costing_matrix_money.final_acquire_percent          new, default -20, Closed Book / management
--   costing_component_costs.final_acquire_percent       new, null = the evaluation's percent
--   costing_component_costs.final_acquire_typed         new; every Final Acquire already stored is kept as typed
--   costing_component_costs.final_acquire_unit          now written by the decider list alone (management band)
--   costing_final_acquire_rule(...)                     the rule
--   trg_costing_final_acquire                           applies it on every write of a costs row
--   triggers on costing_components.status and on the matrix percent re-work the rule-filled lines
--   costing_planned_cost_total, costing_matrix_page     a Component with no Final Acquire is unknown, not its Acquire
-- Cost-only rows (costing_cost_rows) are untouched: they keep their Final Acquire, else their Acquire.
-- Redefines costing_planned_cost_total and costing_matrix_page (latest: 20261121060000_892_matrix_page_acquire_fallback.sql).

alter table public.costing_matrix_money
  add column if not exists final_acquire_percent numeric(7,2) not null default -20;
alter table public.costing_matrix_money
  drop constraint if exists costing_matrix_money_final_percent_chk;
alter table public.costing_matrix_money
  add constraint costing_matrix_money_final_percent_chk check (final_acquire_percent > -100 and final_acquire_percent <= 1000);
comment on column public.costing_matrix_money.final_acquire_percent is
  '#962: the evaluation''s default percent on the Odoo SRP for a Stockable line (starts at -20). Written by the decider list; read by closed_book only.';

alter table public.costing_component_costs
  add column if not exists final_acquire_percent numeric(7,2);
alter table public.costing_component_costs
  add column if not exists final_acquire_typed boolean not null default false;
alter table public.costing_component_costs
  drop constraint if exists costing_component_costs_final_percent_chk;
alter table public.costing_component_costs
  add constraint costing_component_costs_final_percent_chk check (final_acquire_percent is null or (final_acquire_percent > -100 and final_acquire_percent <= 1000));
comment on column public.costing_component_costs.final_acquire_percent is
  '#962: this line''s own percent on the Odoo SRP. Null = the evaluation''s percent. Written by the decider list.';
comment on column public.costing_component_costs.final_acquire_typed is
  '#962: true when a decider typed final_acquire_unit over the rule. A typed value never moves; writing it blank puts the line back on the rule.';

-- Final Acquire values already stored on old evaluations are kept as typed values.
update public.costing_component_costs set final_acquire_typed = true where final_acquire_unit is not null;

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

-- Numeric rounds half away from zero, as costingMath.js does. Null while an input is blank: never zero.
create or replace function public.costing_final_acquire_rule(p_status text, p_odoo numeric, p_percent numeric, p_acquire numeric, p_p0 numeric)
returns numeric
language sql
immutable
as $$
  select case p_status
    when 'stockable' then
      case when p_odoo is null or p_percent is null then null else round(p_odoo * (100 + p_percent) / 100, 2) end
    when 'source_out' then coalesce(p_p0, p_acquire)
    else null
  end
$$;
revoke all on function public.costing_final_acquire_rule(text, numeric, numeric, numeric, numeric) from public, anon, authenticated;

create or replace function public.costing_final_acquire_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  text;
  v_matrix  uuid;
  v_default numeric;
  v_wrote   boolean;
begin
  v_wrote := case when tg_op = 'INSERT' then new.final_acquire_unit is not null
                  else new.final_acquire_unit is distinct from old.final_acquire_unit end;
  -- A value written is typed; written blank, the line goes back on the rule.
  if v_wrote then
    new.final_acquire_typed := new.final_acquire_unit is not null;
  end if;
  if new.final_acquire_unit is null then
    new.final_acquire_typed := false;
  end if;
  if new.final_acquire_typed then
    return new;
  end if;

  select c.status into v_status from public.costing_components c where c.id = new.component_id;
  v_matrix := public.costing_matrix_of('costing_component_costs', jsonb_build_object('component_id', new.component_id));
  select m.final_acquire_percent into v_default from public.costing_matrix_money m where m.matrix_id = v_matrix;
  new.final_acquire_unit := public.costing_final_acquire_rule(
    v_status, new.odoo_unit, coalesce(new.final_acquire_percent, v_default, -20), new.acquire_unit, new.p0_unit_price);
  return new;
end;
$$;
revoke all on function public.costing_final_acquire_apply() from public, anon, authenticated;

-- Named to fire after costing_bands (the band check judges what the caller wrote, not what the rule works out).
drop trigger if exists trg_costing_final_acquire on public.costing_component_costs;
create trigger trg_costing_final_acquire
  before insert or update on public.costing_component_costs
  for each row execute function public.costing_final_acquire_apply();

-- A rule-filled line follows its Status and the evaluation's percent: touch the row so the rule is worked again.
create or replace function public.costing_final_acquire_touch_component()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was text := coalesce(current_setting('costing.bypass', true), '');
begin
  perform set_config('costing.bypass', 'on', true);
  update public.costing_component_costs cc
     set component_id = cc.component_id
   where cc.component_id = new.id and not cc.final_acquire_typed;
  perform set_config('costing.bypass', v_was, true);
  return new;
end;
$$;
revoke all on function public.costing_final_acquire_touch_component() from public, anon, authenticated;

drop trigger if exists trg_costing_final_acquire_status on public.costing_components;
create trigger trg_costing_final_acquire_status
  after update of status on public.costing_components
  for each row when (old.status is distinct from new.status)
  execute function public.costing_final_acquire_touch_component();

create or replace function public.costing_final_acquire_touch_matrix()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was text := coalesce(current_setting('costing.bypass', true), '');
begin
  perform set_config('costing.bypass', 'on', true);
  update public.costing_component_costs cc
     set component_id = cc.component_id
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
   where cc.component_id = c.id
     and t.matrix_id = new.matrix_id
     and not cc.final_acquire_typed
     and cc.final_acquire_percent is null;
  perform set_config('costing.bypass', v_was, true);
  return new;
end;
$$;
revoke all on function public.costing_final_acquire_touch_matrix() from public, anon, authenticated;

drop trigger if exists trg_costing_final_acquire_percent on public.costing_matrix_money;
create trigger trg_costing_final_acquire_percent
  after insert or update of final_acquire_percent on public.costing_matrix_money
  for each row execute function public.costing_final_acquire_touch_matrix();

-- Lines already on the sheet: work the rule once (no caller, so the band check lets it through).
update public.costing_component_costs set component_id = component_id where not final_acquire_typed;

-- ---------------------------------------------------------------------------
-- Registry rows: Closed Book reads, the decider list ('management') writes
-- ---------------------------------------------------------------------------

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_matrix_money', 'final_acquire_percent', '{closed_book}'),
  ('costing_component_costs', 'final_acquire_percent', '{closed_book}'),
  ('costing_component_costs', 'final_acquire_typed', '{closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_matrix_money', 'final_acquire_percent', '{management}'),
  ('costing_component_costs', 'final_acquire_percent', '{management}'),
  ('costing_component_costs', 'final_acquire_typed', '{management}'),
  ('costing_component_costs', 'final_acquire_unit', '{management}')
on conflict (table_name, column_name) do update set bands = excluded.bands;


create or replace function public.costing_planned_cost_total(p_matrix_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when count(*) > 0 and bool_and(x.fa is not null) then sum(round(x.fa * x.q, 2)) end
  from (
    select cc.final_acquire_unit as fa, c.quantity as q
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
    where t.matrix_id = p_matrix_id
    union all
    select coalesce(r.final_acquire_unit, r.acquire_unit), r.quantity
    from public.costing_cost_rows r
    where r.matrix_id = p_matrix_id
  ) x
$$;
revoke all on function public.costing_planned_cost_total(uuid) from public, anon, authenticated;

create or replace function public.costing_matrix_page()
returns table (
  opportunity_id uuid,
  sor_code text,
  sales_reference text,
  project_title text,
  stage text,
  entities text[],
  final_offer_total numeric,
  final_acquire_total numeric,
  landed_cost_total numeric,
  bought_final_acquire_total numeric,
  items_bought integer,
  items_total integer,
  ipas_short boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- Super Admins and the list read every SOR; anyone else, the SORs they are open on.
  v_all boolean := coalesce(public.is_super_admin(), false) or public.costing_on_list('final_acquire');
begin
  if public.get_employee_id() is null then
    raise exception 'costing_matrix_page: not signed in' using errcode = '42501';
  end if;
  if not (v_all or public.costing_is_open_anywhere()) then
    raise exception 'costing_matrix_page: only Super Admins, Purchasing, the Deal Team and the Final Acquire list read the S0 Evaluation page'
      using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.sor_code,
    o.sales_reference,
    o.project_title,
    fs.name,
    coalesce(ent.names, '{}'::text[]),
    offer.total,
    acquire.total,
    lc.landed,
    lc.bought_acquire,
    lc.bought,
    lc.total_items,
    (shortage.open_short or lc.provisional)
  from public.costing_matrices m
  join public.sales_opportunities o on o.id = m.opportunity_id
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  cross join lateral (
    select case when count(*) > 0 and bool_and(p.final_offer_unit is not null)
                then sum(round(p.final_offer_unit * t.quantity, 2)) end as total
    from public.costing_tender_lines t
    left join public.costing_tender_line_prices p on p.tender_line_id = t.id
    where t.matrix_id = m.id
  ) offer
  cross join lateral (
    select case when count(*) > 0 and bool_and(x.fa is not null)
                then sum(round(x.fa * x.q, 2)) end as total
    from (
      select cc.final_acquire_unit as fa, c.quantity as q
      from public.costing_components c
      join public.costing_tender_lines t on t.id = c.tender_line_id
      left join public.costing_component_costs cc on cc.component_id = c.id
      where t.matrix_id = m.id
      union all
      select coalesce(r.final_acquire_unit, r.acquire_unit), r.quantity
      from public.costing_cost_rows r
      where r.matrix_id = m.id
    ) x
  ) acquire
  cross join lateral (
    select
      count(*)::integer as total_items,
      (count(*) filter (where l.total_php is not null
        or exists (select 1 from public.purchase_request_items pi
                    where pi.component_id = c.id and pi.status in ('purchased', 'received'))))::integer as bought,
      -- Each Component's Landed Cost is rounded to the centavo before it is added, as the SOR summary does.
      coalesce(sum(round(l.total_php, 2)) filter (where l.total_php is not null), 0) as landed,
      case when coalesce(bool_and(l.total_php is null or cc.final_acquire_unit is not null), true)
           then coalesce(sum(round(cc.final_acquire_unit * c.quantity, 2)) filter (where l.total_php is not null), 0)
      end as bought_acquire,
      coalesce(bool_or(l.total_php is not null and l.mark is distinct from 'final'), false) as provisional
    from public.costing_components c
    join public.costing_tender_lines t on t.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
    left join public.costing_landed_costs(o.id) l on l.component_id = c.id
    where t.matrix_id = m.id
  ) lc
  cross join lateral (
    select exists (
      select 1
      from public.ipas i
      join public.ipas_sors s on s.ipas_id = i.id
      where s.opportunity_id = o.id
        and i.purpose = 'project'
        and i.state = 'open'
        and coalesce(i.computation_status, '') not in ('lc_odoo_done', 'costs_complete', 'checked')
    ) as open_short
  ) shortage
  cross join lateral (
    select array_agg(distinct e.name order by e.name) as names
    from (
      select nullif(btrim(coalesce(nullif(btrim(i.entity_override), ''), i.odoo_copy #>> '{po,company}')), '') as name
      from public.ipas i
      join public.ipas_sors s on s.ipas_id = i.id
      where s.opportunity_id = o.id
        and i.purpose = 'project'
        and i.state <> 'cancelled'
    ) e
    where e.name is not null
  ) ent
  where not coalesce(o.is_deleted, false)
    and not coalesce(o.is_scratch, false)
    and (v_all or public.costing_is_open(o.id))
  order by o.serial_no desc;
end;
$$;
