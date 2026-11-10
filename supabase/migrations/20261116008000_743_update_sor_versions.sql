-- Update SORs to a chosen Flow Snapshot, with who-may-do-it checked here
-- (issue #743, spec #735). Replaces nothing: the older
-- move_opportunities_to_flow_snapshot stays for existing callers.
--
-- Who may update which SOR:
--   * a Super Admin: any SOR, to any version of its flow (newer or older);
--   * a head: only SORs of their own department (the Deal Owner's, else the
--     registrant's, department);
--   * the Deal Team: their own SOR, one at a time (a batch of exactly one).
-- Anyone else is refused with a reason. A version that lacks the SOR's current
-- Stage is refused, never stranded. Touches flow_snapshot_id only.
--
-- SECURITY DEFINER so the checks above, not the sor_update policy, decide.
-- Each SOR is its own sub-transaction; one failing never stops the batch.
-- Every update writes a History (timeline) note and an audit entry.

create or replace function public.update_sor_versions(
  p_opportunity_ids uuid[],
  p_target_snapshot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_actor_row employees%rowtype;
  v_is_super boolean := false;
  v_ids uuid[] := coalesce(p_opportunity_ids, '{}'::uuid[]);
  v_target flow_snapshots%rowtype;
  v_target_label text;
  v_id uuid;
  v_opp sales_opportunities%rowtype;
  v_source flow_snapshots%rowtype;
  v_source_label text;
  v_label text;
  v_event jsonb;
  v_opp_department text;
  v_allowed boolean;
  v_moved jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'Not signed in.';
  end if;
  select * into v_actor_row from employees where id = v_actor;
  v_is_super := coalesce(v_actor_row.is_super_admin, false);

  select * into v_target from flow_snapshots where id = p_target_snapshot_id;
  if not found then
    raise exception 'Flow Snapshot not found.';
  end if;
  v_target_label := 'v' || v_target.version || '.' || coalesce(v_target.version_minor, 0);

  foreach v_id in array v_ids loop
    begin
      select * into v_opp from sales_opportunities where id = v_id;
      if not found or v_opp.is_deleted is true then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'This deal no longer exists or you cannot see it.');
        continue;
      end if;

      -- Permission first, so a refusal never leaks anything about the deal.
      v_allowed := v_is_super;
      if not v_allowed and coalesce(v_actor_row.is_head, false) then
        select e.department into v_opp_department
          from employees e
         where e.id = coalesce(v_opp.deal_owner_id, v_opp.registered_by);
        v_allowed := v_opp_department is not null
          and v_opp_department is not distinct from v_actor_row.department;
      end if;
      if not v_allowed
         and array_length(v_ids, 1) = 1
         and public.sor_is_deal_team(v_opp, v_actor) then
        v_allowed := true;
      end if;
      if not v_allowed then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'You are not allowed to update this deal''s version.');
        continue;
      end if;

      if v_opp.sale_type_id is null then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'This deal does not run a Sales Flow, so it has no version to update.');
        continue;
      end if;

      if not exists (
        select 1 from sales_flows
         where sale_type_id = v_opp.sale_type_id and id = v_target.flow_id
      ) then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'That version belongs to a different flow.');
        continue;
      end if;

      if v_opp.flow_snapshot_id = v_target.id then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', 'This deal is already on ' || v_target_label || '.');
        continue;
      end if;

      if not exists (
        select 1
          from jsonb_array_elements(coalesce(v_target.snapshot_data -> 'stages', '[]'::jsonb)) st
         where st ->> 'id' = v_opp.flow_stage_id::text
      ) then
        v_failed := v_failed || jsonb_build_object(
          'id', v_id,
          'reason', 'This deal''s current Stage does not exist in ' || v_target_label
            || ', so it cannot be put on that version. Move it to a different Stage first, or choose a different version.'
        );
        continue;
      end if;

      v_source_label := 'no version';
      if v_opp.flow_snapshot_id is not null then
        select * into v_source from flow_snapshots where id = v_opp.flow_snapshot_id;
        v_source_label := case
          when found then 'v' || v_source.version || '.' || coalesce(v_source.version_minor, 0)
          else 'an unknown version'
        end;
      end if;

      update sales_opportunities
         set flow_snapshot_id = v_target.id
       where id = v_id;

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
        'Updated from ' || v_source_label || ' to ' || v_target_label || '.',
        v_event
      );
      insert into system_audit_logs (author_id, type, entity_type, entity_id, content, metadata)
      values (
        v_actor, 'SYSTEM', 'OPPORTUNITY', v_id,
        v_label || ': updated from ' || v_source_label || ' to ' || v_target_label || '.',
        v_event
      );

      v_moved := v_moved || jsonb_build_object('id', v_id);
    exception when others then
      v_failed := v_failed || jsonb_build_object('id', v_id, 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('moved', v_moved, 'failed', v_failed);
end;
$$;

revoke all on function public.update_sor_versions(uuid[], uuid) from public;
grant execute on function public.update_sor_versions(uuid[], uuid) to authenticated;
