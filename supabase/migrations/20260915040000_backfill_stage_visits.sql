-- Issue #203, story 31 — backfill Stage Visits from history that already
-- exists: every SOR's STAGE_CHANGED timeline entries, so a deal that has
-- been through several loops before this migration starts with a complete
-- visit history instead of one Visit 1 covering its whole life.
--
-- Runs once, for flow-built deals only (flow_stage_id not null) — the
-- trigger from the prior migration only fires going forward, so this is the
-- one-time catch-up for every row already in the table before it existed.
-- Idempotent: skips an opportunity that already has a visit (the trigger
-- will have created exactly one, from this migration's own insert firing
-- nothing further, or from a row inserted between the two migrations).

do $$
declare
  v_deal record;
  v_entry record;
  v_sequence integer;
  v_current_stage uuid;
  v_entered_at timestamptz;
  v_open_visit_id uuid;
begin
  for v_deal in
    select id, flow_stage_id, flow_snapshot_id, created_at, registered_by
    from public.sales_opportunities
    where flow_stage_id is not null
      and not exists (select 1 from public.sor_stage_visits where opportunity_id = sales_opportunities.id)
  loop
    v_sequence := 1;
    v_entered_at := v_deal.created_at;
    v_current_stage := null;
    v_open_visit_id := null;

    for v_entry in
      select metadata->>'to' as to_stage, created_at
      from public.sales_opportunity_logs
      where opportunity_id = v_deal.id
        and metadata->>'event' = 'STAGE_CHANGED'
        and metadata->>'to' is not null
      order by created_at asc
    loop
      if v_open_visit_id is not null then
        update public.sor_stage_visits set left_at = v_entry.created_at where id = v_open_visit_id;
      end if;

      insert into public.sor_stage_visits
        (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at, entered_by)
      values
        (v_deal.id, v_entry.to_stage::uuid, v_deal.flow_snapshot_id, v_sequence, v_entered_at, v_deal.registered_by)
      returning id into v_open_visit_id;

      v_sequence := v_sequence + 1;
      v_entered_at := v_entry.created_at;
      v_current_stage := v_entry.to_stage::uuid;
    end loop;

    -- No STAGE_CHANGED entry at all (a deal registered straight onto its
    -- current Stage): one visit, opened at registration, still open.
    if v_current_stage is null then
      insert into public.sor_stage_visits
        (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at, entered_by)
      values
        (v_deal.id, v_deal.flow_stage_id, v_deal.flow_snapshot_id, 1, v_deal.created_at, v_deal.registered_by);
    end if;
  end loop;
end $$;

-- Attach every existing sor_condition_status row to the visit that was open
-- when it was written — the latest visit on that condition's Stage whose
-- entered_at is on or before the row's satisfied_at.
update public.sor_condition_status scs
set stage_visit_id = v.id
from public.stage_conditions sc
join lateral (
  select ssv.id
  from public.sor_stage_visits ssv
  where ssv.opportunity_id = scs.opportunity_id
    and ssv.flow_stage_id = sc.stage_id
    and ssv.entered_at <= scs.satisfied_at
  order by ssv.entered_at desc
  limit 1
) v on true
where scs.condition_id = sc.id
  and scs.stage_visit_id is null;
