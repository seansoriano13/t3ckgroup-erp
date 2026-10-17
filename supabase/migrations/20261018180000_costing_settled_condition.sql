-- Costing Matrix, the Costing settled Stage Condition (#272, spec #266).
--
-- WHAT THIS ADDS
--   stage_conditions kind   'costing_settled' (no config). The CHECK keeps every older kind:
--                           published Flow Snapshots and a snapshot restore re-insert them.
--   costing_condition_inputs(opp)
--                           the evidence the costing conditions read, as booleans and
--                           counts only: whether a matrix exists, how many Tender Lines,
--                           how many lack a Final Offer, whether the Final Offer total is
--                           over the ABC total (the comparison is done here, to the
--                           centavo, so no peso figure leaves), how many costed rows
--                           (Components and cost-only rows) there are and how many lack a
--                           Final Acquire, whether the evaluation is approved, and the
--                           live Bid Decision's verdict. costingMath.costingSettled turns
--                           it into met / failing checks in the browser. Shared with
--                           #463 (Costing priced), which adds its own keys.
--   costing_mark_bid_submitted(opp)
--                           sets costing_matrices.bid_submitted_at when empty. Called by
--                           the browser right after a move out of a Stage whose
--                           costing_settled condition was met.
--   Trigger                 once bid_submitted_at is set, a change to a Tender Line's Final
--                           Offer writes a SYSTEM entry on the SOR's timeline (no figures).
--                           Before it is set, nothing.
--
-- ACCESS
--   costing_condition_inputs: anyone who can see the SOR (sor_access_level <> 'none'), the
--   same rule as the Purchasing settled evidence, because the gate runs in the mover's
--   browser and the mover may be unable to read the matrix. It returns booleans and counts
--   only, never a peso figure, a cost or a name.
--   costing_mark_bid_submitted: only the employee who has just moved the SOR out of a Stage
--   (they closed a visit in the last two minutes). Moves nothing else.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: drop-then-add constraint, create-or-replace
-- functions, drop-then-create trigger.

alter table public.stage_conditions drop constraint if exists stage_conditions_kind_chk;
alter table public.stage_conditions add constraint stage_conditions_kind_chk check (kind in ('attachment', 'field', 'tickbox', 'assignment', 'deadline', 'project_evaluation', 'inclusions', 'purchasing', 'purchasing_settled', 'costing_settled'));

-- Functions
-- ---------------------------------------------------------------------------
-- The evidence
-- ---------------------------------------------------------------------------

-- Booleans and counts about the SOR's Costing Matrix. {"has_matrix": false} when none has been
-- opened (a normal state: the matrix exists only once Open Costing Matrix runs).
--
--   line_count          Tender Lines
--   missing_offer       Tender Lines with no Final Offer
--   over_abc            Final Offer total above ABC total, to the centavo; false unless every
--                       Tender Line has both prices (an ABC only means something when it
--                       covers every line, the same rule as costingMath.matrixTotals)
--   costed_rows         Components plus cost-only rows
--   missing_cost        of those, how many have no Final Acquire
--   evaluation_approved the live "Evaluation approved" sign-off exists
--   bid_verdict         the live Bid Decision: 'go' | 'no_go' | 'revise' | null
create or replace function public.costing_condition_inputs(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_matrix  uuid;
  v_totals  record;
  v_costed  integer;
  v_missing integer;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_condition_inputs: sign in first' using errcode = '42501';
  end if;
  if public.sor_access_level(p_opportunity_id) = 'none' then
    raise exception 'costing_condition_inputs: you can''t see this SOR' using errcode = '42501';
  end if;

  select m.id into v_matrix from public.costing_matrices m where m.opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return jsonb_build_object('has_matrix', false);
  end if;

  select * into v_totals from public.costing_bid_totals(v_matrix);

  select count(*), count(*) filter (where cc.final_acquire_unit is null)
    into v_costed, v_missing
    from public.costing_components c
    join public.costing_tender_lines l on l.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
   where l.matrix_id = v_matrix;

  v_costed := v_costed + (select count(*) from public.costing_cost_rows r where r.matrix_id = v_matrix);
  v_missing := v_missing + (select count(*) from public.costing_cost_rows r
                             where r.matrix_id = v_matrix and r.final_acquire_unit is null);

  return jsonb_build_object(
    'has_matrix', true,
    'line_count', v_totals.line_count,
    'missing_offer', v_totals.missing_offer,
    'over_abc', coalesce(v_totals.final_offer_total > v_totals.abc_total, false),
    'costed_rows', v_costed,
    'missing_cost', v_missing,
    'evaluation_approved', exists (
      select 1 from public.costing_signoffs s
       where s.matrix_id = v_matrix and s.role = 'evaluation_approved' and s.cleared_at is null),
    'bid_verdict', (select d.verdict from public.costing_bid_decisions d
                     where d.matrix_id = v_matrix and d.cleared_at is null)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Bid submitted
-- ---------------------------------------------------------------------------

-- Stamps bid_submitted_at (once) for the SOR the caller has just moved out of a Stage. The
-- move is judged in the browser, so this only trusts that the caller closed a visit a moment
-- ago; it never moves anything. Returns whether this call set the stamp.
create or replace function public.costing_mark_bid_submitted(p_opportunity_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_done  integer;
begin
  if v_actor is null then
    raise exception 'costing_mark_bid_submitted: sign in first' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.sor_stage_visits v
     where v.opportunity_id = p_opportunity_id
       and v.left_by = v_actor
       and v.left_at > now() - interval '2 minutes'
  ) then
    raise exception 'costing_mark_bid_submitted: only the person who just moved the SOR can do this' using errcode = '42501';
  end if;

  perform set_config('costing.bypass', 'on', true);
  update public.costing_matrices
     set bid_submitted_at = now()
   where opportunity_id = p_opportunity_id and bid_submitted_at is null;
  get diagnostics v_done = row_count;
  perform set_config('costing.bypass', 'off', true);
  return v_done > 0;
end;
$$;

-- After the bid is submitted, a Final Offer change is told on the SOR's timeline (the open
-- Stage Visit, filled by sor_set_log_stage_visit). The entry carries the Tender Line's number
-- and no figures: the timeline is read by people who never see Final Offers.
create or replace function public.costing_log_final_offer_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp      uuid;
  v_submit   timestamptz;
  v_position integer;
begin
  if tg_op = 'INSERT' and new.final_offer_unit is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.final_offer_unit is not distinct from old.final_offer_unit then
    return null;
  end if;

  select m.opportunity_id, m.bid_submitted_at, l.position
    into v_opp, v_submit, v_position
    from public.costing_tender_lines l
    join public.costing_matrices m on m.id = l.matrix_id
   where l.id = new.tender_line_id;
  if v_opp is null or v_submit is null then
    return null;
  end if;

  insert into public.sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
  values (
    v_opp,
    public.get_employee_id(),
    'SYSTEM',
    format('Final Offer changed on Tender Line %s after the bid was submitted.', v_position),
    jsonb_build_object('event', 'COSTING_FINAL_OFFER_CHANGED', 'tender_line_id', new.tender_line_id)
  );
  return null;
end;
$$;

drop trigger if exists costing_final_offer_log on public.costing_tender_line_prices;
create trigger costing_final_offer_log after insert or update of final_offer_unit on public.costing_tender_line_prices
  for each row execute function public.costing_log_final_offer_change();

revoke all on function public.costing_condition_inputs(uuid) from public, anon;
grant execute on function public.costing_condition_inputs(uuid) to authenticated;
revoke all on function public.costing_mark_bid_submitted(uuid) from public, anon;
grant execute on function public.costing_mark_bid_submitted(uuid) to authenticated;
revoke all on function public.costing_log_final_offer_change() from public, anon, authenticated;
