-- ==============================================================================
-- 20261005132000_terminal_stage_outcome.sql
--
-- A Terminal Stage says how deals end there: Won or Lost.
--
-- A flow names one Won Stage, which usually sits mid-flow with PO, delivery and
-- collection still ahead; the flow then ends on Terminal Stages such as Closed
-- Won and Closed Lost. Nothing said which of those was a win, so every Terminal
-- Stage other than the Won Stage read as lost: a deal at Closed Won left the
-- Realized Commission Pool, the board warned "lost", and its Purchase Request
-- was treated as dead.
--
-- `flow_stages.terminal_outcome`: 'won' or 'lost' on a Terminal Stage, null
-- otherwise. A Terminal Stage with none set ends as lost, as before. Set in
-- Flow Canvas; carried by Flow Snapshots and restored with them.
--
-- BACKFILL: a Terminal Stage reachable from its flow's Won Stage along the
-- flow's moves is marked 'won', in the live flow and in every Flow Snapshot
-- (from that snapshot's own Stages, moves and Won Stage), so deals on older
-- versions read the same. Every other Terminal Stage is left unset (lost). A
-- post-award cancellation Stage downstream of the Won Stage needs setting back
-- to Lost in Flow Canvas by hand.
--
-- Also: the Purchase Request rule for a lost SOR (20261005131900) reads the
-- outcome, and restore_flow_snapshot (20260929020000) carries it.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: one nullable
-- column (an older frontend ignores it), guarded backfills, two redefinitions.
-- Idempotent.
-- ==============================================================================

alter table public.flow_stages add column if not exists terminal_outcome text;

alter table public.flow_stages drop constraint if exists flow_stages_terminal_outcome_chk;
alter table public.flow_stages add constraint flow_stages_terminal_outcome_chk check (
  terminal_outcome is null or (is_terminal and terminal_outcome in ('won', 'lost'))
);

comment on column public.flow_stages.terminal_outcome is
  'How deals end on a Terminal Stage: won (e.g. Closed Won, after the Won Stage) or lost. Null on a non-terminal Stage; null on a Terminal Stage means lost.';

-- ------------------------------------------------------------------------------
-- Backfill: live flows
-- ------------------------------------------------------------------------------

with recursive reach (flow_id, stage_id) as (
  select f.id, f.won_stage_id from public.sales_flows f where f.won_stage_id is not null
  union
  select r.flow_id, e.to_stage_id
  from reach r
  join public.flow_edges e on e.flow_id = r.flow_id and e.from_stage_id = r.stage_id
)
update public.flow_stages s
set terminal_outcome = 'won'
from reach r, public.sales_flows f
where s.id = r.stage_id
  and f.id = r.flow_id
  and s.is_terminal
  and s.id is distinct from f.won_stage_id
  and s.terminal_outcome is null;

-- ------------------------------------------------------------------------------
-- Backfill: Flow Snapshots
-- ------------------------------------------------------------------------------

do $backfill$
declare
  v_snap record;
  v_won text;
  v_reached text[];
  v_stages jsonb;
begin
  for v_snap in select id, snapshot_data from public.flow_snapshots loop
    v_won := v_snap.snapshot_data->>'wonStageId';
    continue when v_won is null;

    with recursive reach (stage_id) as (
      select v_won
      union
      select e->>'to_stage_id'
      from reach r
      join jsonb_array_elements(coalesce(v_snap.snapshot_data->'edges', '[]'::jsonb)) e
        on e->>'from_stage_id' = r.stage_id
    )
    select array_agg(stage_id) into v_reached from reach;

    select jsonb_agg(
      case
        when coalesce((st->>'is_terminal')::boolean, false)
          and st->>'id' <> v_won
          and st->>'id' = any (v_reached)
          and coalesce(st->>'terminal_outcome', '') = ''
        then st || jsonb_build_object('terminal_outcome', 'won')
        else st
      end
      order by ord
    ) into v_stages
    from jsonb_array_elements(coalesce(v_snap.snapshot_data->'stages', '[]'::jsonb)) with ordinality as x(st, ord);

    if v_stages is distinct from v_snap.snapshot_data->'stages' then
      update public.flow_snapshots
      set snapshot_data = jsonb_set(snapshot_data, '{stages}', v_stages)
      where id = v_snap.id;
    end if;
  end loop;
end
$backfill$;

-- ------------------------------------------------------------------------------
-- A lost SOR reads the outcome (redefines 20261005131900)
-- ------------------------------------------------------------------------------

-- Why an SOR is closed for Purchasing: 'deleted'; 'lost' on a Terminal Stage
-- other than the Won Stage that doesn't end as won; else null.
create or replace function public._sor_purchasing_closed_reason(p_opp public.sales_opportunities)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(p_opp.is_deleted, false) then 'deleted'
    when exists (
      select 1
      from flow_stages s
      join sales_flows f on f.id = s.flow_id
      where s.id = p_opp.flow_stage_id
        and s.is_terminal
        and s.id is distinct from f.won_stage_id
        and coalesce(s.terminal_outcome, 'lost') = 'lost'
    ) then 'lost'
  end;
$$;

revoke all on function public._sor_purchasing_closed_reason(public.sales_opportunities) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- Restore carries the outcome (redefines 20260929020000; body unchanged but
-- for terminal_outcome on the Stage upsert)
-- ------------------------------------------------------------------------------

create or replace function public.restore_flow_snapshot(
  p_flow_id uuid,
  p_snapshot_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flow record;
  v_snapshot record;
  v_data jsonb;
  v_target_stage_ids uuid[];
  v_target_edge_ids uuid[];
  v_target_action_ids uuid[];
  v_target_condition_ids uuid[];
  v_target_field_ids uuid[];
  v_target_form_field_ids uuid[];
  v_target_follow_up_stage_ids uuid[];
  v_won_stage_id uuid;
  v_blockers text[] := array[]::text[];
  v_rec record;
  v_elem jsonb;
begin
  -- Lock the Sales Flow row first (ADR 0013 / lock_sales_flow).
  select * into v_flow from sales_flows where id = p_flow_id for update;
  if not found then
    raise exception 'Sales Flow not found.';
  end if;
  if v_flow.state <> 'draft' then
    raise exception 'This Sales Flow is locked. Unlock it first, with a reason, to make changes.';
  end if;

  select * into v_snapshot from flow_snapshots where id = p_snapshot_id;
  if not found then
    raise exception 'That Flow Snapshot does not exist.';
  end if;
  if v_snapshot.flow_id <> p_flow_id then
    raise exception 'That Flow Snapshot does not belong to this flow.';
  end if;

  v_data := v_snapshot.snapshot_data;
  v_won_stage_id := nullif(v_data->>'wonStageId', '')::uuid;

  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_stage_ids
  from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) as e;

  -- Refuse before writing anything if a live Stage the target drops is still
  -- referenced by an SOR. The foreign key sees soft-deleted SORs too, so they
  -- count, and the message says when they are the whole reason.
  for v_rec in
    select st.name as stage_name,
           count(*) as total,
           count(*) filter (where o.is_deleted is true) as soft_deleted
    from flow_stages st
    join sales_opportunities o on o.flow_stage_id = st.id
    where st.flow_id = p_flow_id
      and not (st.id = any(v_target_stage_ids))
    group by st.id, st.name
    order by st.name
  loop
    v_blockers := array_append(
      v_blockers,
      format(
        '"%s" is referenced by %s SOR%s%s',
        v_rec.stage_name,
        v_rec.total,
        case when v_rec.total = 1 then '' else 's' end,
        case
          when v_rec.soft_deleted = v_rec.total then format(' (all %s soft-deleted)', v_rec.total)
          when v_rec.soft_deleted > 0 then format(' (%s of them soft-deleted)', v_rec.soft_deleted)
          else ''
        end
      )
    );
  end loop;
  if array_length(v_blockers, 1) > 0 then
    raise exception 'This version cannot be restored yet: %. Move those deals to another Stage first.',
      array_to_string(v_blockers, '; ');
  end if;

  -- From here the draft is reshaped to match the target, keeping ids. Clear
  -- the Won Stage first so a dropped Stage that held it can be deleted.
  update sales_flows set won_stage_id = null, updated_at = now() where id = p_flow_id;

  -- Two Stages can swap names. The one-name-per-flow index is checked row by
  -- row, so park every surviving Stage on a unique placeholder first.
  update flow_stages set name = '__restore__' || id::text where flow_id = p_flow_id;

  -- Drop the Stages the target does not have. Their edges, conditions and
  -- actions go by cascade; the check above proved no SOR is referenced.
  delete from flow_stages
   where flow_id = p_flow_id
     and not (id = any(v_target_stage_ids));

  -- Upsert every target Stage under its original id.
  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) as e
  loop
    insert into flow_stages (
      id, flow_id, name, sort_order, is_terminal, terminal_outcome, pos_x, pos_y, color, bracket_label, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      v_elem->>'name',
      coalesce((v_elem->>'sort_order')::int, 0),
      coalesce((v_elem->>'is_terminal')::boolean, false),
      case when coalesce((v_elem->>'is_terminal')::boolean, false) then nullif(v_elem->>'terminal_outcome', '') end,
      coalesce((v_elem->>'pos_x')::int, 0),
      coalesce((v_elem->>'pos_y')::int, 0),
      nullif(v_elem->>'color', ''),
      nullif(v_elem->>'bracket_label', ''),
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      name = excluded.name,
      sort_order = excluded.sort_order,
      is_terminal = excluded.is_terminal,
      terminal_outcome = excluded.terminal_outcome,
      pos_x = excluded.pos_x,
      pos_y = excluded.pos_y,
      color = excluded.color,
      bracket_label = excluded.bracket_label,
      updated_at = now();
  end loop;

  -- Moves.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_edge_ids
  from jsonb_array_elements(coalesce(v_data->'edges', '[]'::jsonb)) as e;

  delete from flow_edges
   where flow_id = p_flow_id
     and not (id = any(v_target_edge_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'edges', '[]'::jsonb)) as e
  loop
    insert into flow_edges (id, flow_id, from_stage_id, to_stage_id, created_at)
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      (v_elem->>'from_stage_id')::uuid,
      (v_elem->>'to_stage_id')::uuid,
      coalesce((v_elem->>'created_at')::timestamptz, now())
    )
    on conflict (id) do update set
      from_stage_id = excluded.from_stage_id,
      to_stage_id = excluded.to_stage_id;
  end loop;

  -- Stage Actions.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_action_ids
  from jsonb_array_elements(coalesce(v_data->'actions', '[]'::jsonb)) as e;

  delete from flow_stage_actions
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (id = any(v_target_action_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'actions', '[]'::jsonb)) as e
  loop
    insert into flow_stage_actions (id, stage_id, kind, config, sort_order, archived_at, created_at, updated_at)
    values (
      (v_elem->>'id')::uuid,
      (v_elem->>'stage_id')::uuid,
      v_elem->>'kind',
      coalesce(v_elem->'config', '{}'::jsonb),
      coalesce((v_elem->>'sort_order')::int, 0),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      stage_id = excluded.stage_id,
      kind = excluded.kind,
      config = excluded.config,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Stage Conditions.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_condition_ids
  from jsonb_array_elements(coalesce(v_data->'conditions', '[]'::jsonb)) as e;

  delete from stage_conditions
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (id = any(v_target_condition_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'conditions', '[]'::jsonb)) as e
  loop
    insert into stage_conditions (id, stage_id, kind, label, is_required, sort_order, config, archived_at, created_at, updated_at)
    values (
      (v_elem->>'id')::uuid,
      (v_elem->>'stage_id')::uuid,
      v_elem->>'kind',
      v_elem->>'label',
      coalesce((v_elem->>'is_required')::boolean, true),
      coalesce((v_elem->>'sort_order')::int, 0),
      coalesce(v_elem->'config', '{}'::jsonb),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      stage_id = excluded.stage_id,
      kind = excluded.kind,
      label = excluded.label,
      is_required = excluded.is_required,
      sort_order = excluded.sort_order,
      config = excluded.config,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Stage Fields (#331). Values recorded against a field cascade from it, so
  -- a field the target lacks is archived, not deleted: the SOR data stays.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_field_ids
  from jsonb_array_elements(coalesce(v_data->'stageFields', '[]'::jsonb)) as e;

  update flow_stage_fields
     set archived_at = now(), updated_at = now()
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (id = any(v_target_field_ids))
     and archived_at is null;

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'stageFields', '[]'::jsonb)) as e
  loop
    insert into flow_stage_fields (
      id, stage_id, label, help, source, sor_field, field_type, options, is_required, sort_order, archived_at, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      (v_elem->>'stage_id')::uuid,
      v_elem->>'label',
      nullif(v_elem->>'help', ''),
      v_elem->>'source',
      nullif(v_elem->>'sor_field', ''),
      v_elem->>'field_type',
      coalesce(v_elem->'options', '[]'::jsonb),
      coalesce((v_elem->>'is_required')::boolean, true),
      coalesce((v_elem->>'sort_order')::int, 0),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      stage_id = excluded.stage_id,
      label = excluded.label,
      help = excluded.help,
      source = excluded.source,
      sor_field = excluded.sor_field,
      field_type = excluded.field_type,
      options = excluded.options,
      is_required = excluded.is_required,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Registration form fields: same archive-don't-delete rule (sor_form_values).
  -- A 'default' row is unique per (flow, default_key). When the draft already
  -- has one for a key the target customizes, under a different id, that row
  -- is updated in place (keeping its id and its values) rather than replaced.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_form_field_ids
  from jsonb_array_elements(coalesce(v_data->'formFields', '[]'::jsonb)) as e;

  update flow_form_fields
     set archived_at = now(), updated_at = now()
   where flow_id = p_flow_id
     and not (id = any(v_target_form_field_ids))
     and not (
       source = 'default'
       and default_key in (
         select e->>'default_key'
         from jsonb_array_elements(coalesce(v_data->'formFields', '[]'::jsonb)) as e
         where e->>'source' = 'default'
       )
     )
     and archived_at is null;

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'formFields', '[]'::jsonb)) as e
  loop
    if v_elem->>'source' = 'default' then
      update flow_form_fields set
        label = nullif(v_elem->>'label', ''),
        help = nullif(v_elem->>'help', ''),
        field_type = nullif(v_elem->>'field_type', ''),
        options = coalesce(v_elem->'options', '[]'::jsonb),
        is_required = (v_elem->>'is_required')::boolean,
        is_hidden = coalesce((v_elem->>'is_hidden')::boolean, false),
        sort_order = coalesce((v_elem->>'sort_order')::int, 0),
        archived_at = nullif(v_elem->>'archived_at', '')::timestamptz,
        updated_at = now()
      where flow_id = p_flow_id
        and source = 'default'
        and default_key = v_elem->>'default_key'
        and id <> (v_elem->>'id')::uuid;
      if found then
        continue;
      end if;
    end if;

    insert into flow_form_fields (
      id, flow_id, source, default_key, label, help, field_type, options, is_required, is_hidden, sort_order, archived_at, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      v_elem->>'source',
      nullif(v_elem->>'default_key', ''),
      nullif(v_elem->>'label', ''),
      nullif(v_elem->>'help', ''),
      nullif(v_elem->>'field_type', ''),
      coalesce(v_elem->'options', '[]'::jsonb),
      (v_elem->>'is_required')::boolean,
      coalesce((v_elem->>'is_hidden')::boolean, false),
      coalesce((v_elem->>'sort_order')::int, 0),
      nullif(v_elem->>'archived_at', '')::timestamptz,
      coalesce((v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update set
      source = excluded.source,
      default_key = excluded.default_key,
      label = excluded.label,
      help = excluded.help,
      field_type = excluded.field_type,
      options = excluded.options,
      is_required = excluded.is_required,
      is_hidden = excluded.is_hidden,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  -- Follow-up Cadence: one row per Stage, carried in the snapshot keyed by
  -- its Stage id (`id` = stage_id), in followUpService's camelCase shape
  -- (everyDays, proofRequired). Nothing hangs off it, so plain replace.
  select coalesce(array_agg((e->>'id')::uuid), array[]::uuid[])
    into v_target_follow_up_stage_ids
  from jsonb_array_elements(coalesce(v_data->'followUps', '[]'::jsonb)) as e;

  delete from flow_stage_follow_ups
   where stage_id in (select id from flow_stages where flow_id = p_flow_id)
     and not (stage_id = any(v_target_follow_up_stage_ids));

  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'followUps', '[]'::jsonb)) as e
  loop
    insert into flow_stage_follow_ups (stage_id, enabled, every_days, recipients, proof_required, created_at, updated_at)
    values (
      (v_elem->>'id')::uuid,
      coalesce((v_elem->>'enabled')::boolean, false),
      nullif(coalesce(v_elem->>'everyDays', v_elem->>'every_days'), '')::int,
      coalesce(v_elem->'recipients', '[{"type":"role","role":"deal_owner"}]'::jsonb),
      coalesce(coalesce(v_elem->>'proofRequired', v_elem->>'proof_required')::boolean, true),
      coalesce(coalesce(v_elem->>'createdAt', v_elem->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (stage_id) do update set
      enabled = excluded.enabled,
      every_days = excluded.every_days,
      recipients = excluded.recipients,
      proof_required = excluded.proof_required,
      updated_at = now();
  end loop;

  -- Access configuration (snapshot `access`) is deliberately NOT restored:
  -- who sees a flow's SORs is set per environment, and the release transfer
  -- (#331) must land Government and Outright with no flow_access_settings.

  update sales_flows
     set won_stage_id = v_won_stage_id,
         updated_at = now()
   where id = p_flow_id
  returning * into v_flow;

  return json_build_object('flow', row_to_json(v_flow), 'version', v_snapshot.version);
end;
$$;

grant execute on function public.restore_flow_snapshot(uuid, uuid) to authenticated;
