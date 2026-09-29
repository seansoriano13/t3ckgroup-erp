-- Issue #389 (parent #384) — a Stage Action can carry on past the Stage.
-- The setting is `config.carries_on` on the action, frozen into the Flow
-- Snapshot with the rest of the action, and read from the SOR's own snapshot.
-- Absent or not true means held (the default).

create or replace function public.stage_action_carries_on(p_snapshot_id uuid, p_action_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (a.value->'config'->>'carries_on') = 'true'
    from public.flow_snapshots s,
      lateral (
        select value from jsonb_array_elements(
          case jsonb_typeof(s.snapshot_data->'actions')
            when 'array' then s.snapshot_data->'actions'
            when 'object' then (
              select coalesce(jsonb_agg(e), '[]'::jsonb)
              from jsonb_each(s.snapshot_data->'actions') g, jsonb_array_elements(g.value) e
            )
            else '[]'::jsonb
          end
        ) value
      ) a
    where s.id = p_snapshot_id and a.value->>'id' = p_action_id::text
    limit 1
  ), false);
$$;

create or replace function public.record_stage_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_sequence integer;
  v_actor uuid;
  v_left_visit uuid;
  v_left_snapshot uuid;
  v_terminal boolean;
  v_cancel text;
  v_stage_name text;
begin
  if coalesce(current_setting('app.sor_revert', true), '') = 'on' then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.flow_stage_id is null then
      return NEW;
    end if;

    insert into public.sor_stage_visits (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at, entered_by)
    values (NEW.id, NEW.flow_stage_id, NEW.flow_snapshot_id, 1, coalesce(NEW.created_at, now()), NEW.registered_by);

    return NEW;
  end if;

  -- UPDATE: only react to an actual stage change.
  if NEW.flow_stage_id is not distinct from OLD.flow_stage_id then
    return NEW;
  end if;

  v_actor := public.get_employee_id();

  update public.sor_stage_visits
    set left_at = now(), left_by = v_actor
    where opportunity_id = NEW.id and left_at is null and undone_at is null
    returning id, flow_snapshot_id into v_left_visit, v_left_snapshot;

  -- Leaving a Stage puts the open tasks its Actions created on hold: off
  -- everyone's lists until a Return decides them, unless the action carries on. Finished work is untouched.
  if v_left_visit is not null then
    update public.tasks
      set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_left_visit
      where stage_visit_id = v_left_visit and stage_action_id is not null
        and status in ('INCOMPLETE', 'AWAITING APPROVAL', 'NOT APPROVED')
        and not public.stage_action_carries_on(v_left_snapshot, stage_action_id);
    update public.committee_tasks
      set held_prev_status = status, status = 'ON_HOLD', held_at = now(), held_from_visit_id = v_left_visit
      where stage_visit_id = v_left_visit and stage_action_id is not null
        and status = 'ACTIVE'
        and not public.stage_action_carries_on(v_left_snapshot, stage_action_id);
  end if;

  -- Nothing can bring a held task back from a Terminal Stage.
  select coalesce(is_terminal, false), name into v_terminal, v_stage_name from public.flow_stages where id = NEW.flow_stage_id;
  if coalesce(v_terminal, false) then
    v_cancel := format('Cancelled: the SOR reached %s, a Terminal Stage.', coalesce(v_stage_name, 'a Terminal Stage'));
    update public.tasks
      set status = 'DELETED', cancel_reason = v_cancel, held_at = null, held_from_visit_id = null, held_prev_status = null
      where opportunity_id = NEW.id and status = 'ON_HOLD';
    update public.committee_tasks
      set status = 'CANCELLED', cancel_reason = v_cancel, held_at = null, held_from_visit_id = null, held_prev_status = null
      where opportunity_id = NEW.id and status = 'ON_HOLD';
  end if;

  if NEW.flow_stage_id is not null then
    select coalesce(max(sequence), 0) + 1 into v_next_sequence
      from public.sor_stage_visits where opportunity_id = NEW.id;

    insert into public.sor_stage_visits
      (opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at, entered_by, contract_date_stamped)
    values
      (NEW.id, NEW.flow_stage_id, NEW.flow_snapshot_id, v_next_sequence, now(), v_actor,
       OLD.contract_date is null and NEW.contract_date is not null);
  end if;

  return NEW;
end;
$$;
