-- #1033 (spec #1031, Decision 2): only the decider list (the final_acquire signer list) or a Super Admin
-- takes Go, Revise or No-go. Sales and Purchasing still read the Closed Book (costing_on_list is not widened)
-- but no longer decide. The queue lists only for those who can decide.
--
-- costing_decide_bid: the live body on staging (same as 20261121180001_880), plus one check up front.
-- costing_pending_bid_decisions: the live body, with the caller test changed from
--   (on the list or open on the matrix) to costing_can_decide_loss() (Super Admin or on the list).
-- costing_unlock_bid already needs a Super Admin or the list; unchanged.
--
-- SAFE TO RUN AT ANY TIME: function replacement only.

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
  v_cost     numeric;
  v_rate     numeric;
  v_allow    numeric;
  v_revenue  numeric;
begin
  if v_actor is null then
    raise exception 'costing_bid: sign in first' using errcode = '42501';
  end if;
  if v_opp is null then
    raise exception 'costing_bid: matrix not found' using errcode = '22023';
  end if;
  if public.costing_tier(v_opp) is distinct from 'closed_book' then
    raise exception 'costing_bid: only a Super Admin or the decider list can decide a bid' using errcode = '42501';
  end if;
  -- #1033 (spec #1031): reading the Closed Book is not deciding. Every verdict is the decider list's or a Super Admin's.
  if not public.costing_can_decide_loss() then
    raise exception 'costing_bid: only a Super Admin or the decider list can decide a bid' using errcode = '42501';
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
    v_cost := public.costing_planned_cost_total(p_matrix_id);
    if v_cost is not null then
      select coalesce(s.itr_rate, 0.08), coalesce(s.itr_allowance, 250000)
        into v_rate, v_allow
        from (select 1) one
        left join public.costing_settings s on s.id = 1;
      v_revenue := (v_totals.final_offer_total - v_cost)
                   - round(greatest(v_totals.final_offer_total - v_allow, 0) * v_rate, 2);
      if v_revenue < 0 and not public.costing_can_decide_loss() then
        raise exception 'costing_bid: a Go on a loss needs a Super Admin or the decider list' using errcode = '42501';
      end if;
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

create or replace function public.costing_pending_bid_decisions()
returns table(matrix_id uuid, opportunity_id uuid, project_title text, client_name text, deal_owner_id uuid, deal_owner_name text, final_offer_total numeric, abc_total numeric, waiting_since timestamp with time zone)
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
  where public.costing_can_decide_loss()
    and not coalesce(o.is_deleted, false)
    and not coalesce(o.is_scratch, false)
    and t.line_count > 0
    and t.missing_offer = 0
    and not exists (
      select 1 from public.costing_bid_decisions d where d.matrix_id = m.id and d.cleared_at is null
    )
  order by 9, m.id
$$;
