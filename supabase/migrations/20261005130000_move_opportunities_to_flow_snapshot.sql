-- Move SORs onto a different Flow Snapshot of their own flow, in one database
-- call per batch (issue #190 follow-up).
--
-- The post-publish "Move N SORs up to vX.Y" offer used to loop in the browser,
-- one SOR at a time (about 8 requests each). Leaving or reloading the page
-- killed the loop mid-way: on prod, two publishes in a row moved exactly the
-- first 8 SORs and left 24 behind. A batch is now one atomic-per-SOR call the
-- page cannot interrupt halfway through a SOR.
--
-- SECURITY INVOKER on purpose: the caller's RLS still decides which SORs they
-- may update (sor_update), so a person cannot move a deal they could not edit
-- by hand. A SOR the update touches no row for is reported, not skipped
-- silently.
--
-- Mirrors moveOpportunitySnapshot in opportunityService.js: it touches
-- flow_snapshot_id only — never flow_stage_id or contract_date — and refuses
-- a SOR whose current Stage does not exist in the target, rather than
-- stranding it. One SOR failing never stops the rest of the batch.

create or replace function public.move_opportunities_to_flow_snapshot(
  p_opportunity_ids uuid[],
  p_target_snapshot_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_target flow_snapshots%rowtype;
  v_target_label text;
  v_actor uuid := public.get_employee_id();
  v_id uuid;
  v_opp sales_opportunities%rowtype;
  v_source flow_snapshots%rowtype;
  v_source_label text;
  v_label text;
  v_event jsonb;
  v_rows integer;
  v_moved jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
begin
  select * into v_target from flow_snapshots where id = p_target_snapshot_id;
  if not found then
    raise exception 'Flow Snapshot not found.';
  end if;
  v_target_label := 'v' || v_target.version || '.' || coalesce(v_target.version_minor, 0);

  foreach v_id in array coalesce(p_opportunity_ids, '{}'::uuid[]) loop
    begin
      select * into v_opp from sales_opportunities where id = v_id;
      if not found or v_opp.is_deleted is true then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'This deal no longer exists or you cannot see it.');
        continue;
      end if;

      if v_opp.sale_type_id is null then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'This deal does not run a Sales Flow, so it has no Flow Snapshot to move.');
        continue;
      end if;

      if not exists (
        select 1 from sales_flows
         where sale_type_id = v_opp.sale_type_id and id = v_target.flow_id
      ) then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'That Flow Snapshot belongs to a different flow.');
        continue;
      end if;

      if not exists (
        select 1
          from jsonb_array_elements(coalesce(v_target.snapshot_data -> 'stages', '[]'::jsonb)) st
         where st ->> 'id' = v_opp.flow_stage_id::text
      ) then
        v_failed := v_failed || jsonb_build_object(
          'id', v_id,
          'reason', 'This deal''s current Stage does not exist in Flow Snapshot ' || v_target_label
            || ', so moving it would strand it. Move it to a different Stage first, or choose a different snapshot.'
        );
        continue;
      end if;

      v_source_label := 'no Flow Snapshot';
      if v_opp.flow_snapshot_id is not null then
        select * into v_source from flow_snapshots where id = v_opp.flow_snapshot_id;
        v_source_label := case
          when found then 'v' || v_source.version || '.' || coalesce(v_source.version_minor, 0)
          else 'an unknown Flow Snapshot'
        end;
      end if;

      update sales_opportunities
         set flow_snapshot_id = v_target.id
       where id = v_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'You do not have permission to move this deal.');
        continue;
      end if;

      v_event := jsonb_build_object(
        'event', 'FLOW_SNAPSHOT_MOVED',
        'from', v_opp.flow_snapshot_id,
        'to', v_target.id,
        'employeeId', v_actor
      );
      v_label := case
        when coalesce(v_opp.sales_reference, '') <> '' then 'Sales opportunity ' || v_opp.sales_reference
        else 'Sales opportunity for ' || v_opp.client_name
      end;

      insert into sales_opportunity_logs (opportunity_id, author_id, type, content, metadata)
      values (
        v_id, v_actor, 'SYSTEM',
        'Flow Snapshot changed: ' || v_source_label || ' → ' || v_target_label || '.',
        v_event
      );
      insert into system_audit_logs (author_id, type, entity_type, entity_id, content, metadata)
      values (
        v_actor, 'SYSTEM', 'OPPORTUNITY', v_id,
        v_label || ': Flow Snapshot changed ' || v_source_label || ' → ' || v_target_label || '.',
        v_event
      );

      v_moved := v_moved || jsonb_build_object('id', v_id);
    exception when others then
      -- The sub-transaction rolls this one SOR back; the batch carries on.
      v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('moved', v_moved, 'failed', v_failed);
end;
$$;

grant execute on function public.move_opportunities_to_flow_snapshot(uuid[], uuid) to authenticated;
