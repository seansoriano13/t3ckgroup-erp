-- S0 Evaluation price corridor (layout F, 2026-11-13): type the Final Offer as one total, as the sheet does.
--
--   costing_matrices.offer_mode    'by_line' (today, the default) or 'total_only'
--   costing_matrices.offer_total   the typed Final Offer total, used in 'total_only'. Blank is never zero.
--
-- The twin of #960's abc_mode / abc_total. Read by the tiers that read final_offer_unit (price, closed_book),
-- written by the Sales band. Per-line final_offer_unit values are never touched by a switch: they stay and come
-- back in 'by_line'. Nothing is spread over the lines.
--
-- One helper, costing_offer_total, is the offer total everywhere: costing_bid_totals (the over-ABC check, the Go
-- checks, the Bid Decision stamp, the pending list), planned Revenue, the S0 Evaluation list, the standalone list
-- and the cost guide. Each of those was adding the line offers up on its own; now they all ask the helper.
--
-- The Go lock (#704) covered the price tables but not the matrix row, so the ABC total could change under a Go.
-- A Go now also refuses a change to abc_mode, abc_total, offer_mode or offer_total.
--
-- SAFE TO RUN AT ANY TIME. Idempotent.

alter table public.costing_matrices add column if not exists offer_mode text not null default 'by_line';
alter table public.costing_matrices add column if not exists offer_total numeric(18,2);

alter table public.costing_matrices drop constraint if exists costing_matrices_offer_mode_chk;
alter table public.costing_matrices add constraint costing_matrices_offer_mode_chk check (offer_mode in ('by_line', 'total_only'));
alter table public.costing_matrices drop constraint if exists costing_matrices_offer_total_chk;
alter table public.costing_matrices add constraint costing_matrices_offer_total_chk check (offer_total is null or offer_total >= 0);

comment on column public.costing_matrices.offer_mode is
  'How the Final Offer is typed: by_line (per Tender Line, default) or total_only (one typed total, as the sheet).';
comment on column public.costing_matrices.offer_total is
  'The typed Final Offer total, used when offer_mode is total_only. Null is blank, never zero.';

insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_matrices', 'offer_mode', '{price,closed_book}'),
  ('costing_matrices', 'offer_total', '{price,closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_matrices', 'offer_mode', '{sales}'),
  ('costing_matrices', 'offer_total', '{sales}')
on conflict (table_name, column_name) do update set bands = excluded.bands;

-- ---------------------------------------------------------------------------
-- The offer total, one rule
-- ---------------------------------------------------------------------------

create or replace function public.costing_offer_total(p_matrix_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when m.offer_mode = 'total_only' then (case when count(l.id) > 0 then m.offer_total end)
    when count(l.id) > 0 and count(l.id) filter (where p.final_offer_unit is null) = 0
      then sum(round(p.final_offer_unit * l.quantity, 2))
  end
  from public.costing_matrices m
  left join public.costing_tender_lines l on l.matrix_id = m.id
  left join public.costing_tender_line_prices p on p.tender_line_id = l.id
  where m.id = p_matrix_id
  group by m.offer_mode, m.offer_total
$$;
revoke all on function public.costing_offer_total(uuid) from public, anon, authenticated;

create or replace function public.costing_bid_totals(p_matrix_id uuid)
returns table (final_offer_total numeric, abc_total numeric, line_count integer, missing_offer integer, missing_abc integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.costing_offer_total(m.id),
    case when m.abc_mode = 'total_only' then (case when count(l.id) > 0 then m.abc_total end)
         when count(l.id) > 0 and count(l.id) filter (where p.abc_unit is null) = 0
         then sum(round(p.abc_unit * l.quantity, 2)) end,
    count(l.id)::integer,
    case when m.offer_mode = 'total_only' then (case when count(l.id) > 0 and m.offer_total is null then 1 else 0 end)
         else (count(l.id) filter (where p.final_offer_unit is null))::integer end,
    case when m.abc_mode = 'total_only' then (case when count(l.id) > 0 and m.abc_total is null then 1 else 0 end)
         else (count(l.id) filter (where p.abc_unit is null))::integer end
  from public.costing_matrices m
  left join public.costing_tender_lines l on l.matrix_id = m.id
  left join public.costing_tender_line_prices p on p.tender_line_id = l.id
  where m.id = p_matrix_id
  group by m.id, m.abc_mode, m.abc_total, m.offer_mode, m.offer_total
$$;

-- ---------------------------------------------------------------------------
-- A Go locks the typed totals too
-- ---------------------------------------------------------------------------

create or replace function public.costing_refuse_totals_when_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if (new.abc_mode, new.abc_total, new.offer_mode, new.offer_total)
       is distinct from (old.abc_mode, old.abc_total, old.offer_mode, old.offer_total)
     and exists (select 1 from public.costing_bid_decisions d
                  where d.matrix_id = new.id and d.cleared_at is null and d.verdict = 'go') then
    raise exception 'costing_bid: the sheet is locked by a Go. Unlock it, with a reason, to change it' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.costing_refuse_totals_when_locked() from public, anon, authenticated;

drop trigger if exists costing_go_lock_totals on public.costing_matrices;
create trigger costing_go_lock_totals before update on public.costing_matrices
  for each row execute function public.costing_refuse_totals_when_locked();

-- ---------------------------------------------------------------------------
-- costing_planned_revenue: the offer total from costing_offer_total (was: 20261202120000_964_summary_follows_sheet.sql)
-- ---------------------------------------------------------------------------

create or replace function public.costing_planned_revenue(p_matrix_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when t.offer is null or t.landed is null or t.expenses is null or mm.marketing is null then null
         else round(t.offer / s.vat_divisor, 2)
              - (round(t.offer * s.retention_rate, 2) + t.landed + t.expenses + mm.marketing)
              - round(greatest(t.offer - s.itr_allowance, 0) * s.itr_rate, 2)
         end
  from public.costing_settings s
  cross join lateral (
    select public.costing_offer_total(p_matrix_id) as offer,
           public.costing_planned_cost_total(p_matrix_id) as landed,
           public.costing_project_expenses_total(p_matrix_id) as expenses
  ) t
  left join public.costing_matrix_money mm on mm.matrix_id = p_matrix_id
  where s.id = 1
$$;

-- ---------------------------------------------------------------------------
-- costing_matrix_page: the offer total from costing_offer_total (was: 20261202120000_964_summary_follows_sheet.sql)
-- ---------------------------------------------------------------------------

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
  project_expenses_total numeric,
  marketing numeric,
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
    expenses.total,
    mm.marketing,
    lc.landed,
    lc.bought_acquire,
    lc.bought,
    lc.total_items,
    (shortage.open_short or lc.provisional)
  from public.costing_matrices m
  join public.sales_opportunities o on o.id = m.opportunity_id
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  cross join lateral (select public.costing_offer_total(m.id) as total) offer
  cross join lateral (
    select case when count(*) > 0 and bool_and(x.fa is not null)
                then sum(round(x.fa * x.q, 2)) end as total
    from (
      select cc.final_acquire_unit as fa, c.quantity as q
      from public.costing_components c
      join public.costing_tender_lines t on t.id = c.tender_line_id
      left join public.costing_component_costs cc on cc.component_id = c.id
      where t.matrix_id = m.id
    ) x
  ) acquire
  cross join lateral (select public.costing_project_expenses_total(m.id) as total) expenses
  left join public.costing_matrix_money mm on mm.matrix_id = m.id
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

-- ---------------------------------------------------------------------------
-- costing_standalone_page: the offer total from costing_offer_total (was: 20261203100000_966_standalone_evaluation.sql)
-- ---------------------------------------------------------------------------

create or replace function public.costing_standalone_page()
returns table (
  matrix_id uuid,
  s0_number text,
  created_by uuid,
  created_at timestamptz,
  sales_incharge_id uuid,
  purchasing_incharge_id uuid,
  tier text,
  line_count integer,
  final_offer_total numeric,
  final_acquire_total numeric,
  project_expenses_total numeric,
  marketing numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.get_employee_id() is null then
    raise exception 'costing_standalone_page: not signed in' using errcode = '42501';
  end if;
  return query
  select
    m.id, m.s0_number, m.created_by, m.created_at, m.sales_incharge_id, m.purchasing_incharge_id,
    t.tier,
    lines.n,
    case when t.tier in ('price', 'closed_book') then offer.total end,
    case when t.tier in ('cost', 'closed_book') then acquire.total end,
    case when t.tier in ('cost', 'closed_book') then public.costing_project_expenses_total(m.id) end,
    case when t.tier = 'closed_book' then mm.marketing end
  from public.costing_matrices m
  cross join lateral (select public.costing_standalone_tier(m.id) as tier) t
  left join public.costing_matrix_money mm on mm.matrix_id = m.id
  cross join lateral (select count(*)::integer as n from public.costing_tender_lines l where l.matrix_id = m.id) lines
  cross join lateral (select public.costing_offer_total(m.id) as total) offer
  cross join lateral (
    select case when count(*) > 0 and bool_and(x.fa is not null)
                then sum(round(x.fa * x.q, 2)) end as total
    from (
      select cc.final_acquire_unit as fa, c.quantity as q
      from public.costing_components c
      join public.costing_tender_lines l on l.id = c.tender_line_id
      left join public.costing_component_costs cc on cc.component_id = c.id
      where l.matrix_id = m.id
    ) x
  ) acquire
  where m.opportunity_id is null
    and t.tier is not null
  order by m.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- costing_cost_guide: the offer total from costing_offer_total (was: 20261116040100_787_missing_cost_reads_acquire.sql)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.costing_cost_guide(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_offer := public.costing_offer_total(v_matrix);
  v_missing_offer := case when v_offer is null then 1 else 0 end;
  if not exists (select 1 from public.costing_tender_lines where matrix_id = v_matrix) or v_missing_offer > 0 then
    v_offer := null;
  end if;

  select coalesce(sum(coalesce(cc.final_acquire_unit, cc.acquire_unit) * c.quantity), 0),
         count(*) filter (where coalesce(cc.final_acquire_unit, cc.acquire_unit) is null)
    into v_product, v_missing_cost
    from public.costing_tender_lines l
    join public.costing_components c on c.tender_line_id = l.id
    left join public.costing_component_costs cc on cc.component_id = c.id
   where l.matrix_id = v_matrix;

  select coalesce(sum(coalesce(r.final_acquire_unit, r.acquire_unit) * r.quantity), 0),
         v_missing_cost + count(*) filter (where coalesce(r.final_acquire_unit, r.acquire_unit) is null)
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
                     select sum(coalesce(r.final_acquire_unit, r.acquire_unit) * r.quantity)
                       from public.costing_cost_rows r
                      where r.matrix_id = v_matrix and r.category_key = k.key
                   ), 0) as total
        ) t
    ) s;

  -- Rows in a category with no Final Acquire yet.
  select v_missing_cost + count(*) into v_missing_cost
    from public.costing_cost_rows r
   where r.matrix_id = v_matrix and r.category_key is not null and coalesce(r.final_acquire_unit, r.acquire_unit) is null;

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
$function$;
