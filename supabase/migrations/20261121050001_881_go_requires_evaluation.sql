-- Costing Matrix, a Go needs the Evaluation of Specification approved first (#881, spec #907).
--
-- WHY: a Go locks the sheet (#704), so a Go taken before the evaluation is approved froze the
-- matrix with no team able to be called in, and Costing settled then blocked the bid.
--
-- WHAT THIS CHANGES
--   costing_decide_bid  a Go is refused until the matrix has a live evaluation_approved sign-off.
--                       No-go and Revise are unchanged and stay available at any time.
--
-- The rest of the function is the latest definition (20261108040000_704_go_locks_matrix.sql), copied
-- as it stood, with only the new check added after the Final Offer check.
--
-- Idempotent: create or replace.

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
