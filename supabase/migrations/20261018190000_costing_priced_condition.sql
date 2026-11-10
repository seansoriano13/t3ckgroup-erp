-- Costing Matrix, the Costing priced Stage Condition (#463, spec #266).
--
-- WHAT THIS ADDS
--   stage_conditions kind   'costing_priced' (no config). The CHECK keeps every older kind
--                           (published Flow Snapshots and a snapshot restore re-insert them).
--   costing_condition_inputs(opp)
--                           #272's evidence, every key kept, plus three for Costing priced:
--                             component_count          Components on the matrix
--                             missing_acquire          Components and cost-only rows with no
--                                                      Acquire unit cost (Inclusions are unpriced
--                                                      and don't count)
--                             has_purchasing_incharge  a Purchasing Incharge is named on the matrix
--                           costingMath.costingPriced turns it into met / failing checks.
--
-- ACCESS: unchanged from #272 (sor_access_level <> 'none'); booleans and counts only.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: drop-then-add constraint, create-or-replace function.

alter table public.stage_conditions drop constraint if exists stage_conditions_kind_chk;
alter table public.stage_conditions add constraint stage_conditions_kind_chk check (kind in ('attachment', 'field', 'tickbox', 'assignment', 'deadline', 'project_evaluation', 'inclusions', 'purchasing', 'purchasing_settled', 'costing_settled', 'costing_priced'));

-- Functions
create or replace function public.costing_condition_inputs(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_matrix      uuid;
  v_incharge    uuid;
  v_totals      record;
  v_costed      integer;
  v_missing     integer;
  v_components  integer;
  v_no_acquire  integer;
begin
  if public.get_employee_id() is null then
    raise exception 'costing_condition_inputs: sign in first' using errcode = '42501';
  end if;
  if public.sor_access_level(p_opportunity_id) = 'none' then
    raise exception 'costing_condition_inputs: you can''t see this SOR' using errcode = '42501';
  end if;

  select m.id, m.purchasing_incharge_id into v_matrix, v_incharge
    from public.costing_matrices m where m.opportunity_id = p_opportunity_id;
  if v_matrix is null then
    return jsonb_build_object('has_matrix', false);
  end if;

  select * into v_totals from public.costing_bid_totals(v_matrix);

  select count(*),
         count(*) filter (where cc.final_acquire_unit is null),
         count(*) filter (where cc.acquire_unit is null)
    into v_components, v_missing, v_no_acquire
    from public.costing_components c
    join public.costing_tender_lines l on l.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
   where l.matrix_id = v_matrix;

  v_costed := v_components + (select count(*) from public.costing_cost_rows r where r.matrix_id = v_matrix);
  v_missing := v_missing + (select count(*) from public.costing_cost_rows r
                             where r.matrix_id = v_matrix and r.final_acquire_unit is null);
  v_no_acquire := v_no_acquire + (select count(*) from public.costing_cost_rows r
                                   where r.matrix_id = v_matrix and r.acquire_unit is null);

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
                     where d.matrix_id = v_matrix and d.cleared_at is null),
    'component_count', v_components,
    'missing_acquire', v_no_acquire,
    'has_purchasing_incharge', v_incharge is not null
  );
end;
$$;

revoke all on function public.costing_condition_inputs(uuid) from public, anon;
grant execute on function public.costing_condition_inputs(uuid) to authenticated;
