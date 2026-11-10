-- Review fixes for 20261102170000_costing_open_to_deal_purchasing.sql.
--
-- 1. That migration made costing_on_list('final_acquire') true for anyone on the Deal Team of any
--    SOR. costing_on_list also feeds sor_access_level, so every salesperson and all of Purchasing
--    could open every SOR that has a Costing Matrix. costing_on_list goes back to list membership
--    only, and each gate that should open is opened on its own, per SOR where it can be.
-- 2. The list-level gates: the markup presets (anyone who sets a factor needs them), the Bid
--    Decision queue and the Costing Matrix page (rows limited to the SORs the caller is open on,
--    unless they are a Super Admin or on the list), and the Final Acquire sign-off (per SOR).
-- 3. Accepting a Canvass brand follows the Brand column: Sales or Purchasing.
-- 4. That migration also took the Final Acquire list out of the Closed Book, the Management band
--    and Finance, so someone on the list but not in Sales or Purchasing lost what they had. The
--    list keeps everything it had; Sales and Purchasing are added beside it, not instead of it.

-- Anyone who is open on at least one SOR. Columns spelt out (sor_is_deal_team's set) so the
-- lookup can use the indexes instead of calling a function per SOR.
create or replace function public.costing_is_open_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with me as (select public.get_employee_id() as id)
  select coalesce(public.is_super_admin(), false)
    or public.has_purchasing_access()
    or exists (
      select 1 from public.sales_opportunities o, me
      where me.id is not null
        and (o.registered_by = me.id or o.deal_owner_id = me.id or o.closing_sales_id = me.id
          or o.support_sales_1_id = me.id or o.support_sales_2_id = me.id or o.sales_director_id = me.id)
    )
$$;

-- Back to list membership only (as 20261018100000_costing_matrix_tender_lines.sql).
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

-- Who reads and edits the markup presets: Super Admins, the list, and anyone who sets a factor.
create or replace function public.costing_can_manage_markup()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_super_admin(), false)
    or public.costing_on_list('final_acquire')
    or public.costing_is_open_anywhere()
$$;

-- costing_pending_bid_decisions (latest: 20261018170000_costing_bid_decision.sql), now per SOR.
create or replace function public.costing_pending_bid_decisions()
returns table (
  matrix_id         uuid,
  opportunity_id    uuid,
  project_title     text,
  client_name       text,
  deal_owner_id     uuid,
  deal_owner_name   text,
  final_offer_total numeric,
  abc_total         numeric,
  waiting_since     timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.opportunity_id, o.project_title, o.client_name, o.deal_owner_id, own.name,
         t.final_offer_total, t.abc_total,
         coalesce(
           (select max(e.created_at) from public.costing_events e
             where e.matrix_id = m.id and e.detail ->> 'table' = 'costing_tender_line_prices'),
           m.created_at
         )
  from public.costing_matrices m
  join public.sales_opportunities o on o.id = m.opportunity_id
  left join public.employees own on own.id = o.deal_owner_id
  cross join lateral public.costing_bid_totals(m.id) t
  where (public.costing_on_list('final_acquire') or public.costing_is_open(m.opportunity_id))
    and not coalesce(o.is_deleted, false)
    and not coalesce(o.is_scratch, false)
    and t.line_count > 0
    and t.missing_offer = 0
    and not exists (
      select 1 from public.costing_bid_decisions d where d.matrix_id = m.id and d.cleared_at is null
    )
  order by 9, m.id
$$;

-- costing_matrix_page (latest: 20261026170000_595_review_fixes.sql), rows limited per SOR.
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
    raise exception 'costing_matrix_page: only Super Admins, Purchasing, the Deal Team and the Final Acquire list read the Costing Matrix page'
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
      select r.final_acquire_unit, r.quantity
      from public.costing_cost_rows r
      where r.matrix_id = m.id
    ) x
  ) acquire
  cross join lateral (
    select
      count(*)::integer as total_items,
      (count(*) filter (where l.total_php is not null))::integer as bought,
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

-- costing_sign (latest: 20261023210000_refusal_codes.sql): the Final Acquire sign-off per SOR.
create or replace function public.costing_sign(p_matrix_id uuid, p_role text, p_decline_signature boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := public.get_employee_id();
  v_opp       uuid;
  v_incharge  uuid;
  v_missing   integer;
  v_signature text;
  v_row       public.costing_signoffs;
begin
  if v_actor is null then
    raise exception 'costing_sign: sign in first' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('prepared', 'costed', 'evaluation_approved', 'final_approved') then
    raise exception 'costing_sign: % is not a sign-off', coalesce(p_role, 'that') using errcode = '22023';
  end if;

  v_opp := public.costing_matrix_opp(p_matrix_id);
  if v_opp is null then
    raise exception 'costing_sign: not found' using errcode = '22023';
  end if;
  if not public.costing_can_read(v_opp) then
    raise exception 'costing_sign: not allowed' using errcode = '42501';
  end if;

  if p_role = 'evaluation_approved' then
    if not public.costing_on_list('evaluation') then
      raise exception 'costing_sign: only someone on the evaluation list can approve the evaluation' using errcode = '42501';
    end if;
  elsif p_role = 'prepared' then
    select m.sales_incharge_id into v_incharge from public.costing_matrices m where m.id = p_matrix_id;
    if v_incharge is distinct from v_actor then
      raise exception 'costing_sign: only the Sales incharge can sign Prepared by' using errcode = '42501';
    end if;
  elsif p_role = 'costed' then
    select m.purchasing_incharge_id into v_incharge from public.costing_matrices m where m.id = p_matrix_id;
    if v_incharge is distinct from v_actor then
      raise exception 'costing_sign: only the Purchasing incharge can sign Costed by' using errcode = '42501';
    end if;
  elsif not (public.costing_on_list('final_acquire') or public.costing_is_open(v_opp)) then
    raise exception 'costing_sign: only Sales, Purchasing or the Final Acquire list can approve the Final Acquire and offer' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('costing_sign:' || p_matrix_id::text));

  if exists (
    select 1 from public.costing_signoffs s
    where s.matrix_id = p_matrix_id and s.role = p_role and s.cleared_at is null
  ) then
    if p_role = 'evaluation_approved' then
      raise exception 'costing_sign: the evaluation is already approved' using errcode = '22023';
    end if;
    raise exception 'costing_sign: that sign-off is already signed' using errcode = '22023';
  end if;

  if p_role = 'evaluation_approved' then
    select count(*) into v_missing
    from public.costing_components c
    join public.costing_tender_lines l on l.id = c.tender_line_id
    where l.matrix_id = p_matrix_id and c.compliance is null;
    if v_missing > 0 then
      raise exception 'costing_sign: % Component% no verdict yet',
        v_missing, case when v_missing = 1 then ' has' else 's have' end
        using errcode = '22023';
    end if;
  end if;

  if not coalesce(p_decline_signature, false) then
    select nullif(btrim(e.signature_path), '') into v_signature from public.employees e where e.id = v_actor;
  end if;

  insert into public.costing_signoffs (matrix_id, role, signed_by, signature_declined, signature_version)
  values (p_matrix_id, p_role, v_actor, coalesce(p_decline_signature, false), v_signature)
  returning * into v_row;

  return jsonb_build_object('signoff', to_jsonb(v_row));
end;
$$;

-- costing_accept_brand (latest: 20261023210000_refusal_codes.sql): Sales or Purchasing, as the Brand column.
create or replace function public.costing_accept_brand(p_component_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp   uuid;
  v_brand text;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_accept_brand: sign in first' using errcode = '42501';
  end if;

  v_opp := public.canvass_component_opportunity(p_component_id);
  if v_opp is null then
    raise exception 'costing_accept_brand: not found' using errcode = '22023';
  end if;
  if not (public.costing_can_read(v_opp)
          and (public.costing_in_band(v_opp, 'sales') or public.costing_in_band(v_opp, 'purchasing'))) then
    raise exception 'costing_accept_brand: only the Deal Team or Purchasing can accept a brand' using errcode = '42501';
  end if;

  select nullif(btrim(coalesce(o.brand, '')), '') into v_brand
    from public.sor_canvasses c
    join public.sor_canvass_offers o on o.canvass_id = c.id and o.is_winner
   where c.component_id = p_component_id;
  if v_brand is null then
    raise exception 'costing_accept_brand: the Canvass has no winning brand' using errcode = '22023';
  end if;

  -- As the caller, so the Sales band trigger judges the write too.
  update public.costing_components set brand = v_brand where id = p_component_id;

  return jsonb_build_object('brand', v_brand);
end;
$$;

-- The read tier: the Final Acquire list stays at the Closed Book beside the SOR's open people.
create or replace function public.costing_tier(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.sales_opportunities o where o.id = p_opportunity_id) then null
    when public.costing_on_list('final_acquire') or public.costing_is_open(p_opportunity_id) then 'closed_book'
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
    when public.costing_on_list('evaluation')
      and exists (select 1 from public.costing_matrices m where m.opportunity_id = p_opportunity_id)
    then 'participant'
    else null
  end
$$;

-- The bands as 20261018100000_costing_matrix_tender_lines.sql had them: Management is the Final
-- Acquire list again. Sales and Purchasing reach the old Management columns through the column
-- bands below instead.
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

update public.costing_column_bands
   set bands = '{sales,purchasing,management}'
 where (table_name, column_name) in (
   ('costing_component_costs', 'final_acquire_unit'),
   ('costing_component_costs', 'markup_factor'),
   ('costing_cost_rows', 'final_acquire_unit'),
   ('costing_cost_rows', 'markup_factor'),
   ('costing_matrix_money', 'default_factor'),
   ('costing_matrix_money', 'default_preset_id')
 );

update public.costing_column_bands
   set bands = '{finance,sales,purchasing,management}'
 where (table_name, column_name) in (
   ('costing_matrix_money', 'marketing'),
   ('costing_matrix_money', 'opex')
 );

-- costing_decide_bid (latest: 20261023210000_refusal_codes.sql): the Closed Book now includes Sales and Purchasing; the refusal says so.
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

  select * into v_totals from public.costing_bid_totals(p_matrix_id);
  if v_totals.line_count = 0 or v_totals.missing_offer > 0 then
    raise exception 'costing_bid: every Tender Line needs a Final Offer before the bid can be decided' using errcode = '22023';
  end if;

  update public.costing_bid_decisions
     set cleared_at = now(), cleared_reason = 'Decided again'
   where matrix_id = p_matrix_id and cleared_at is null;

  insert into public.costing_bid_decisions (matrix_id, verdict, reason, decided_by, final_offer_total, abc_total)
  values (p_matrix_id, p_verdict, btrim(p_reason), v_actor, v_totals.final_offer_total, v_totals.abc_total)
  returning id into v_id;

  if p_verdict in ('no_go', 'revise') then
    select o.project_title into v_title from public.sales_opportunities o where o.id = v_opp;
    v_label := case p_verdict when 'no_go' then 'No-go' else 'Revise' end;
    -- The Deal Team, once each, never the decider. The message carries the verdict and the
    -- reason, and no figure: Sales never reads the numbers a decision was taken against.
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
