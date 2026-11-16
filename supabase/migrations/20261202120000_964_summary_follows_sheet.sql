-- S0 Evaluation summary follows the sheet; the 20% Go line (#964, spec #955 decision 4).
--
-- WHAT THIS CHANGES
--   costing_settings.go_line_percent   new, starts at 20: the Revenue / Final Offer line the bid goes ahead on (a warning only)
--   costing_project_expenses_total     new: the Other costs rows added up (null while a typed row has no amount)
--   costing_planned_cost_total         now the Landed Cost (planned): the Components' Final Acquire only
--   costing_planned_revenue            new: Revenue the sheet's way, VAT-exclusive - OPEX - ITR; mirrors costingMath.summary
--   costing_decide_bid                 the loss-making Go check (#880) reads costing_planned_revenue
--   costing_matrix_page                final_acquire_total is Components only; adds project_expenses_total and marketing
-- The typed costing_matrix_money.opex column stays in the database but nothing reads it any more.
-- Redefines costing_planned_cost_total and costing_matrix_page (latest: 20261202105000_962_final_acquire_rule.sql)
-- and costing_decide_bid (latest: 20261121180001_880_loss_making_go_restricted.sql).

alter table public.costing_settings add column if not exists go_line_percent numeric(7,2) not null default 20;
alter table public.costing_settings drop constraint if exists costing_settings_go_line_chk;
alter table public.costing_settings add constraint costing_settings_go_line_chk check (go_line_percent >= 0 and go_line_percent <= 100);
comment on column public.costing_settings.go_line_percent is
  '#964: the Go line. A bid whose Revenue is below this percent of the Final Offer shows a warning; it never blocks a Go.';

create or replace function public.costing_project_expenses_total(p_matrix_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when count(*) > 0 and bool_and(x.amount is not null) then sum(x.amount) end
  from (
    select round(coalesce(r.final_acquire_unit, r.acquire_unit) * r.quantity, 2) as amount
    from public.costing_cost_rows r
    where r.matrix_id = p_matrix_id
      and (r.abc_pct is not null or r.acquire_unit is not null or r.final_acquire_unit is not null)
  ) x
$$;
revoke all on function public.costing_project_expenses_total(uuid) from public, anon, authenticated;

create or replace function public.costing_planned_cost_total(p_matrix_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when count(*) > 0 and bool_and(cc.final_acquire_unit is not null)
              then sum(round(cc.final_acquire_unit * c.quantity, 2)) end
  from public.costing_components c
  join public.costing_tender_lines t on t.id = c.tender_line_id
  left join public.costing_component_costs cc on cc.component_id = c.id
  where t.matrix_id = p_matrix_id
$$;
revoke all on function public.costing_planned_cost_total(uuid) from public, anon, authenticated;

-- Revenue the sheet's way. Null while any input is blank (a blank is never zero).
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
    select (select case when count(l.id) > 0 and count(l.id) filter (where p.final_offer_unit is null) = 0
                        then sum(round(p.final_offer_unit * l.quantity, 2)) end
              from public.costing_tender_lines l
              left join public.costing_tender_line_prices p on p.tender_line_id = l.id
             where l.matrix_id = p_matrix_id) as offer,
           public.costing_planned_cost_total(p_matrix_id) as landed,
           public.costing_project_expenses_total(p_matrix_id) as expenses
  ) t
  left join public.costing_matrix_money mm on mm.matrix_id = p_matrix_id
  where s.id = 1
$$;
revoke all on function public.costing_planned_revenue(uuid) from public, anon, authenticated;

create or replace function public.costing_decide_bid(p_matrix_id uuid, p_verdict text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := public.get_employee_id();
  v_opp    uuid := public.costing_matrix_opp(p_matrix_id);
  v_totals record;
  v_id     uuid;
  v_title  text;
  v_label  text;
  v_member record;
  v_revenue  numeric;
begin
  if v_actor is null then
    raise exception 'costing_bid: sign in first' using errcode = '42501';
  end if;
  if v_opp is null then
    raise exception 'costing_bid: matrix not found' using errcode = '22023';
  end if;
  if public.costing_tier(v_opp) is distinct from 'closed_book' then
    raise exception 'costing_bid: only Sales, Purchasing, a Super Admin or the Final Acquire list can decide a bid' using errcode = '42501';
  end if;
  if p_verdict is null or p_verdict not in ('go', 'no_go', 'revise') then
    raise exception 'costing_bid: the verdict must be Go, No-go or Revise' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'costing_bid: write the reason for the decision' using errcode = '22023';
  end if;

  -- One decision at a time per matrix (ADR 0013).
  perform 1 from public.costing_matrices where id = p_matrix_id for update;

  if exists (select 1 from public.costing_bid_decisions where matrix_id = p_matrix_id and cleared_at is null and verdict = 'go') then
    raise exception 'costing_bid: the sheet is locked by a Go. Unlock it first' using errcode = '22023';
  end if;

  select * into v_totals from public.costing_bid_totals(p_matrix_id);
  if v_totals.line_count = 0 or v_totals.missing_offer > 0 then
    raise exception 'costing_bid: every Tender Line needs a Final Offer before the bid can be decided' using errcode = '22023';
  end if;

  -- #881: a Go waits for the Evaluation of Specification to be approved (No-go and Revise do not).
  if p_verdict = 'go' and not exists (
    select 1 from public.costing_signoffs s
     where s.matrix_id = p_matrix_id and s.role = 'evaluation_approved' and s.cleared_at is null) then
    raise exception 'costing_bid: approve the Evaluation of Specification first' using errcode = '22023';
  end if;

  -- #880: a Go on a loss (planned revenue below zero) is the Super Admin's or the decider list's to take.
  if p_verdict = 'go' then
    v_revenue := public.costing_planned_revenue(p_matrix_id);
    if v_revenue is not null and v_revenue < 0 and not public.costing_can_decide_loss() then
      raise exception 'costing_bid: a Go on a loss needs a Super Admin or the decider list' using errcode = '42501';
    end if;
  end if;

  update public.costing_bid_decisions
     set cleared_at = now(), cleared_reason = 'Decided again'
   where matrix_id = p_matrix_id and cleared_at is null;

  insert into public.costing_bid_decisions (matrix_id, verdict, reason, decided_by, final_offer_total, abc_total, planned_cost_total)
  values (p_matrix_id, p_verdict, btrim(p_reason), v_actor, v_totals.final_offer_total, v_totals.abc_total,
          public.costing_planned_cost_total(p_matrix_id))
  returning id into v_id;

  if p_verdict in ('no_go', 'revise') then
    select o.project_title into v_title from public.sales_opportunities o where o.id = v_opp;
    v_label := case p_verdict when 'no_go' then 'No-go' else 'Revise' end;
    for v_member in
      select distinct t.employee_id
      from public.sales_opportunities o
      cross join lateral public._sor_deal_team_roles(o) t
      join public.employees e on e.id = t.employee_id
      where o.id = v_opp
        and t.employee_id <> v_actor
        and not coalesce(e.is_deleted, false)
    loop
      insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
      values (
        v_member.employee_id,
        v_actor,
        'SOR_BID_DECISION',
        format('Bid decision: %s', v_label),
        format('The bid on "%s" is %s: %s', coalesce(v_title, 'this deal'), v_label, btrim(p_reason)),
        v_opp::text
      );
    end loop;
  end if;

  return v_id;
end;
$$;

drop function if exists public.costing_matrix_page();

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

revoke all on function public.costing_matrix_page() from public, anon;
grant execute on function public.costing_matrix_page() to authenticated;
