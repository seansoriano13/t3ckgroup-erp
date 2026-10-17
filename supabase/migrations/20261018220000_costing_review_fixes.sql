-- Costing Matrix, the code-review fixes (#266 review).
--
-- WHAT THIS CHANGES
--   costing_cost_rows.markup_price_unit
--                      no longer read by the price tier (Closed Book only). A cost-only row with
--                      no factor is x1.00, so its Markup Price was its Acquire to the centavo:
--                      Sales could read Purchasing's cost. Components keep the price tier's
--                      Markup Price (their factor is never x1.00 by default).
--   costing_move_legacy_inclusions
--                      dropped. It opened a matrix for an SOR with old Inclusions, against "no
--                      matrix at registration, no backfill". It already ran once (#268) and
--                      nothing calls it. Its only event, the 'changed' entry on the pseudo-column
--                      legacy_sor_inclusion, is gone with it, so no registry row is needed.
--   costing_settled_met(matrix)
--                      new, internal: the Costing settled verdict worked out from the same
--                      evidence as costing_condition_inputs, in SQL. Same rule as
--                      costingMath.costingSettled.
--   costing_condition_inputs(opp)
--                      callers whose tier is price or closed_book keep the full evidence.
--                      Everyone else who can see the SOR (cost, participant, no tier) is sent
--                      no bid_verdict, no over_abc and none of the other settled evidence, only
--                      the server's `settled_met`. The Costing priced evidence (component
--                      count, missing Acquire count, Purchasing incharge) holds no money and is
--                      sent to all.
--   costing_mark_bid_submitted(opp)
--                      stamps bid_submitted_at only when the visit the caller has just left was
--                      on a Stage that has an active costing_settled condition AND the matrix
--                      meets it right now. Otherwise it stamps nothing and returns false.
--
-- ACCESS: unchanged (see each function). No new table, band or tier.
--
-- SAFE TO RUN AT ANY TIME. Idempotent: registry upsert, drop-if-exists, create-or-replace.

-- Registry rows
insert into public.costing_column_tiers (table_name, column_name, tiers) values
  ('costing_cost_rows', 'markup_price_unit', '{closed_book}')
on conflict (table_name, column_name) do update set tiers = excluded.tiers;

-- Functions
drop function if exists public.costing_move_legacy_inclusions(uuid);

-- Whether a matrix meets Costing settled: Tender Lines exist and each has a Final Offer, the
-- Final Offer total is not over the ABC total, something is costed and every costed row has a
-- Final Acquire, the evaluation is approved, and the live Bid Decision is Go. Internal: it is
-- called by costing_condition_inputs and costing_mark_bid_submitted, which decide who sees it.
create or replace function public.costing_settled_met(p_matrix_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_totals  record;
  v_costed  integer;
  v_missing integer;
begin
  if p_matrix_id is null then
    return false;
  end if;

  select * into v_totals from public.costing_bid_totals(p_matrix_id);
  if coalesce(v_totals.line_count, 0) = 0 or coalesce(v_totals.missing_offer, 1) <> 0 then
    return false;
  end if;
  if coalesce(v_totals.final_offer_total > v_totals.abc_total, false) then
    return false;
  end if;

  select count(*), count(*) filter (where cc.final_acquire_unit is null)
    into v_costed, v_missing
    from public.costing_components c
    join public.costing_tender_lines l on l.id = c.tender_line_id
    left join public.costing_component_costs cc on cc.component_id = c.id
   where l.matrix_id = p_matrix_id;
  v_costed := v_costed + (select count(*) from public.costing_cost_rows r where r.matrix_id = p_matrix_id);
  v_missing := v_missing + (select count(*) from public.costing_cost_rows r
                             where r.matrix_id = p_matrix_id and r.final_acquire_unit is null);
  if v_costed = 0 or v_missing <> 0 then
    return false;
  end if;

  return exists (
           select 1 from public.costing_signoffs s
            where s.matrix_id = p_matrix_id and s.role = 'evaluation_approved' and s.cleared_at is null)
     and coalesce((select d.verdict from public.costing_bid_decisions d
                    where d.matrix_id = p_matrix_id and d.cleared_at is null), '') = 'go';
end;
$$;

-- The evidence the costing conditions read. {"has_matrix": false} when no matrix is opened.
--   price and closed_book tiers  every key (see #272/#463): line_count, missing_offer, over_abc,
--                                costed_rows, missing_cost, evaluation_approved, bid_verdict,
--                                component_count, missing_acquire, has_purchasing_incharge,
--                                and settled_met.
--   everyone else                has_matrix, settled_met (the server's verdict), and the Costing
--                                priced counts. Nothing that says why settled fails, or how the
--                                Bid Decision or the offer against the ABC stands.
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
  v_tier        text;
  v_priced      jsonb;
  v_settled     boolean;
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

  v_settled := public.costing_settled_met(v_matrix);
  v_priced := jsonb_build_object(
    'component_count', v_components,
    'missing_acquire', v_no_acquire,
    'has_purchasing_incharge', v_incharge is not null
  );

  v_tier := public.costing_tier(p_opportunity_id);
  if v_tier in ('price', 'closed_book') then
    return jsonb_build_object(
      'has_matrix', true,
      'settled_met', v_settled,
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
    ) || v_priced;
  end if;

  return jsonb_build_object('has_matrix', true, 'settled_met', v_settled) || v_priced;
end;
$$;

-- Stamps bid_submitted_at (once) for the SOR the caller has just moved out of a Stage. The move is
-- judged in the browser, so this trusts only that the caller closed a visit a moment ago; it then
-- checks for itself that the Stage the visit was on carries an active costing_settled condition
-- (from the visit's Flow Snapshot, else the live Stage) and that the matrix meets it now. Anything
-- else stamps nothing and returns false. It never moves anything. Returns whether it set the stamp.
create or replace function public.costing_mark_bid_submitted(p_opportunity_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := public.get_employee_id();
  v_visit  record;
  v_gated  boolean := false;
  v_seen   boolean := false;
  v_matrix uuid;
  v_done   integer;
begin
  if v_actor is null then
    raise exception 'costing_mark_bid_submitted: sign in first' using errcode = '42501';
  end if;

  for v_visit in
    select v.flow_stage_id, v.flow_snapshot_id
      from public.sor_stage_visits v
     where v.opportunity_id = p_opportunity_id
       and v.left_by = v_actor
       and v.left_at > now() - interval '2 minutes'
       and v.undone_at is null
  loop
    v_seen := true;
    if v_visit.flow_snapshot_id is not null
       and exists (select 1 from public.flow_snapshots fs where fs.id = v_visit.flow_snapshot_id) then
      select exists (
        select 1
          from public.flow_snapshots fs
         cross join lateral (
           select case jsonb_typeof(fs.snapshot_data->'conditions')
                    when 'array' then fs.snapshot_data->'conditions'
                    when 'object' then (select coalesce(jsonb_agg(x.value), '[]'::jsonb)
                                          from jsonb_each(fs.snapshot_data->'conditions') j
                                         cross join lateral jsonb_array_elements(j.value) x)
                    else '[]'::jsonb
                  end as rows
         ) r
         cross join lateral jsonb_array_elements(r.rows) c
         where fs.id = v_visit.flow_snapshot_id
           and c->>'stage_id' = v_visit.flow_stage_id::text
           and c->>'kind' = 'costing_settled'
           and coalesce(c->>'archived_at', '') = ''
      ) into v_gated;
    else
      select exists (
        select 1 from public.stage_conditions sc
         where sc.stage_id = v_visit.flow_stage_id
           and sc.kind = 'costing_settled'
           and sc.archived_at is null
      ) into v_gated;
    end if;
    exit when v_gated;
  end loop;

  if not v_seen then
    raise exception 'costing_mark_bid_submitted: only the person who just moved the SOR can do this' using errcode = '42501';
  end if;
  if not v_gated then
    return false;
  end if;

  select m.id into v_matrix from public.costing_matrices m where m.opportunity_id = p_opportunity_id;
  if not public.costing_settled_met(v_matrix) then
    return false;
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

revoke all on function public.costing_settled_met(uuid) from public, anon, authenticated;
revoke all on function public.costing_condition_inputs(uuid) from public, anon;
grant execute on function public.costing_condition_inputs(uuid) to authenticated;
revoke all on function public.costing_mark_bid_submitted(uuid) from public, anon;
grant execute on function public.costing_mark_bid_submitted(uuid) to authenticated;
