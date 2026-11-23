-- #1197 (spec #1187): a date Stage Field a Sales Flow marks "Show on Calendar" puts an all-day entry on the Calendar.
--
-- WHY: nothing put the Retention release date (when the warranty ends and Retention Money can be collected) on the
-- Calendar. The Calendar never finds the field by its name, since a rename would break that silently; the flow
-- marks the field instead. Sean turns it on for "Retention release date" on the Project flow's Retention stage.
--
-- WHAT THIS ADDS
--   * flow_stage_fields.show_on_calendar: false by default; only a custom date field may be true.
--   * calendar_entries() (ADR 0037): one new kind, SOR_DATE. The body is copied from
--     20261217120000_1056_activity_days.sql (the newest definition) with the SOR_DATE branch added.
--     Who sees it is checked inside the function with _sor_visible_visit_ids_as (ADR 0021).
--
-- Idempotent: the column and constraint are added only if missing, and the function is replaced.

alter table public.flow_stage_fields add column if not exists show_on_calendar boolean not null default false;

alter table public.flow_stage_fields drop constraint if exists flow_stage_fields_show_on_calendar_chk;
alter table public.flow_stage_fields add constraint flow_stage_fields_show_on_calendar_chk
  check (not show_on_calendar or (source = 'custom' and field_type = 'date'));

create or replace function public.calendar_entries(
  p_from date,
  p_to date,
  p_include_pending boolean default false
)
returns table (
  kind text,
  id uuid,
  group_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  manila_date date,
  employee jsonb,
  status text,
  hours numeric,
  venue text,
  title text,
  details jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_viewer uuid := public.get_employee_id();
  v_hr boolean := false;
  v_super boolean := false;
  v_pending boolean;
begin
  if v_viewer is null then
    return;
  end if;

  select coalesce(e.is_hr, false) or coalesce(e.is_super_admin, false) or coalesce(e.can_manage_leaves, false),
         coalesce(e.is_super_admin, false)
    into v_hr, v_super
    from public.employees e
    where e.id = v_viewer;
  v_hr := coalesce(v_hr, false);
  v_super := coalesce(v_super, false);
  v_pending := v_hr and coalesce(p_include_pending, false);

  return query
  select q.* from (
    with src as (
      -- ---- SIL ------------------------------------------------------------
      select 'SIL'::text as kind, s.id, s.leave_group_id as group_id, s.employee_id,
             s.date, s.start_time, s.end_time,
             s.status as raw_status, s.hours, 'SIL'::text as title, s.reason
        from public.sil_leaves s
        where s.date between p_from and p_to
      union all
      -- ---- LWOP -----------------------------------------------------------
      select 'LWOP', l.id, l.leave_group_id, l.employee_id,
             l.date, l.start_time, l.end_time,
             l.status, l.hours, 'LWOP', l.reason
        from public.lwop_leaves l
        where l.date between p_from and p_to
      union all
      -- ---- OFFSET ---------------------------------------------------------
      select 'OFFSET', o.id, o.leave_group_id, o.employee_id,
             o.date, o.start_time, o.end_time,
             o.status, o.hours, 'Offset', o.reason
        from public.offset_leaves o
        where o.date between p_from and p_to
      union all
      -- ---- OVERTIME -------------------------------------------------------
      select 'OVERTIME', ot.id, ot.id, ot.employee_id,
             ot.date, ot.start_time, ot.end_time,
             ot.status, coalesce(ot.approved_hours, ot.hours), 'Overtime', ot.reason
        from public.overtime_requests ot
        where ot.date between p_from and p_to
      union all
      -- ---- UNDERTIME ------------------------------------------------------
      select 'UNDERTIME', u.id, u.id, u.employee_id,
             u.date,
             coalesce(u.actual_start_time, u.original_start_time),
             coalesce(u.actual_end_time, u.original_end_time),
             u.status, coalesce(u.approved_hours, u.hours), 'Undertime', u.reason
        from public.undertime_requests u
        where u.date between p_from and p_to
    )
    select
      s.kind,
      s.id,
      s.group_id,
      ((s.date + coalesce(s.start_time, time '00:00')) at time zone 'Asia/Manila') as starts_at,
      ((s.date + coalesce(s.end_time, time '23:59:59')) at time zone 'Asia/Manila') as ends_at,
      (s.start_time is null) as all_day,
      s.date as manila_date,
      jsonb_build_object('id', e.id, 'name', e.name, 'department', e.department, 'avatar', e.avatar_path) as employee,
      case when s.raw_status = 'PENDING' then 'PENDING' else 'APPROVED' end as status,
      s.hours,
      null::text as venue,
      s.title,
      case when v_hr or s.employee_id = v_viewer
           then jsonb_build_object('reason', s.reason)
           else '{}'::jsonb end as details
    from src s
    join public.employees e on e.id = s.employee_id
    where (s.raw_status in ('APPROVED', 'APPROVED_PAID', 'APPROVED_OFFSET')
           or (s.raw_status = 'PENDING' and v_pending))

    union all


    -- ---- MEETING (one entry per Activity day) -----------------------------
    select
      'MEETING'::text,
      d.id,
      m.id,
      d.starts_at,
      d.ends_at,
      false,
      (d.starts_at at time zone 'Asia/Manila')::date,
      jsonb_build_object('id', a.id, 'name', a.name, 'department', a.department, 'avatar', a.avatar_path),
      case when m.status in ('APPROVED', 'CANCELLED') then 'APPROVED' else 'PENDING' end,
      round((extract(epoch from (d.ends_at - d.starts_at)) / 3600.0)::numeric, 2),
      v.name,
      m.purpose,
      jsonb_build_object(
        'stage', m.status,
        'request_id', m.id,
        'day_index', d.day_index,
        'days_total', d.days_total,
        'range_start', (d.range_start at time zone 'Asia/Manila')::date,
        'range_end', (d.range_end at time zone 'Asia/Manila')::date,
        'last_day_starts_at', d.range_end,
        'purpose', m.purpose,
        'venue', v.name,
        'activity_type', m.activity_type,
        'meeting_type', m.meeting_type,
        'meeting_link', m.meeting_link,
        'facilitator', jsonb_build_object('id', f.id, 'name', f.name),
        'participants', coalesce((
          select jsonb_agg(jsonb_build_object('id', pe.id, 'name', pe.name) order by pe.name)
          from public.meeting_request_participants mp
          join public.employees pe on pe.id = mp.employee_id
          where mp.request_id = m.id
        ), '[]'::jsonb),
        'guests', to_jsonb(m.guests),
        'guest_emails', to_jsonb(m.guest_emails)
      )
    from public.meeting_requests m
    join (
      select dd.id, dd.request_id, dd.starts_at, dd.ends_at,
             row_number() over (partition by dd.request_id order by dd.starts_at) as day_index,
             count(*) over (partition by dd.request_id) as days_total,
             min(dd.starts_at) over (partition by dd.request_id) as range_start,
             max(dd.starts_at) over (partition by dd.request_id) as range_end
        from public.meeting_request_days dd
    ) d on d.request_id = m.id
    left join public.calendar_venues v on v.id = m.venue_id
    join public.employees a on a.id = m.applicant_id
    join public.employees f on f.id = m.facilitator_id
    where (
        m.status in ('PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED')
        or (m.status = 'CANCELLED' and m.cancelled_at is not null and m.cancelled_at > m.starts_at)
      )
      and (d.starts_at at time zone 'Asia/Manila')::date between p_from and p_to

    union all

    -- ---- SOR_DATE: a date Stage Field marked "Show on Calendar" (#1197) -------
    -- The SOR's latest value for the field, all day on that date. Only a caller who can see the Stage Visit
    -- the value sits on (ADR 0021) gets a row; everyone else gets nothing, not a blank slot. Deleted,
    -- scratch and Lost SORs, archived fields, and a cleared or non-date value give none.
    select
      'SOR_DATE'::text,
      sv.id,
      sv.opportunity_id,
      (sv.d::timestamp at time zone 'Asia/Manila'),
      ((sv.d + 1)::timestamp at time zone 'Asia/Manila') - interval '1 second',
      true,
      sv.d,
      null::jsonb,
      'APPROVED'::text,
      null::numeric,
      null::text,
      coalesce(nullif(btrim(o.project_title), ''), o.client_name) || ' · ' || sv.label,
      jsonb_build_object(
        'opportunity_id', o.id,
        'field_id', sv.field_id,
        'field_label', sv.label,
        'sales_reference', o.sales_reference,
        'client_name', o.client_name
      )
    from (
      select distinct on (val.opportunity_id, val.field_id)
             val.id, val.opportunity_id, val.field_id, val.stage_visit_id, f.label,
             case when (val.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' then (val.value #>> '{}')::date end as d
        from public.sor_stage_field_values val
        join public.flow_stage_fields f on f.id = val.field_id and f.show_on_calendar and f.archived_at is null
        join public.sor_stage_visits vis on vis.id = val.stage_visit_id and vis.undone_at is null
       order by val.opportunity_id, val.field_id, val.updated_at desc, val.id
    ) sv
    join public.sales_opportunities o on o.id = sv.opportunity_id
    where sv.d between p_from and p_to
      and not coalesce(o.is_deleted, false)
      and not coalesce(o.is_scratch, false)
      and not exists (select 1 from public.crm_pipeline_stages ps where ps.code = o.status and ps.is_lost)
      and exists (
        select 1 from public._sor_visible_visit_ids_as(o.id, v_viewer, v_super) as vv(id)
        where vv.id = sv.stage_visit_id
      )
  ) q
  order by q.manila_date, q.starts_at, q.id;
end;
$function$;

revoke all on function public.calendar_entries(date, date, boolean) from public, anon;
grant execute on function public.calendar_entries(date, date, boolean) to authenticated;


-- restore_flow_snapshot (copied from 20261122000000) now carries show_on_calendar.
-- A snapshot taken before this column existed has no key, which reads as false.
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
  v_award_stage_id uuid;
  v_contract_stage_id uuid;
  v_blockers text[] := array[]::text[];
  v_rec record;
  v_elem jsonb;
begin
  -- #884: a signed-in employee must be a Super Admin or a Flow editor. RLS would
  -- refuse the writes below anyway; this says so plainly, before anything changes.
  -- With no signed-in user (the service role, or a direct database connection
  -- such as scripts/transfer-sales-flows.mjs) auth.role() is not
  -- 'authenticated', so operator tooling is not gated here.
  if auth.role() = 'authenticated' and not (is_super_admin() or can_edit_sales_flows()) then
    raise exception 'Only a Super Admin or a Flow editor can restore a Sales Flow.'
      using errcode = '42501';
  end if;
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
  v_award_stage_id := nullif(v_data->>'awardStageId', '')::uuid;
  v_contract_stage_id := nullif(v_data->>'contractStageId', '')::uuid;

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
  update sales_flows set won_stage_id = null, award_stage_id = null, contract_stage_id = null, updated_at = now() where id = p_flow_id;

  -- Two Stages can swap names. The one-name-per-flow index is checked row by
  -- row, so park every surviving Stage on a unique placeholder first.
  -- The one-flag-per-flow index is checked row by row too, so clear the flag here and set it from the target.
  update flow_stages set name = '__restore__' || id::text, buying_opens_here = false where flow_id = p_flow_id;

  -- Drop the Stages the target does not have. Their edges, conditions and
  -- actions go by cascade; the check above proved no SOR is referenced.
  delete from flow_stages
   where flow_id = p_flow_id
     and not (id = any(v_target_stage_ids));

  -- Upsert every target Stage under its original id.
  for v_elem in select e from jsonb_array_elements(coalesce(v_data->'stages', '[]'::jsonb)) as e
  loop
    insert into flow_stages (
      id, flow_id, name, sort_order, is_terminal, terminal_outcome, buying_opens_here, pos_x, pos_y, color, bracket_label, created_at, updated_at
    )
    values (
      (v_elem->>'id')::uuid,
      p_flow_id,
      v_elem->>'name',
      coalesce((v_elem->>'sort_order')::int, 0),
      coalesce((v_elem->>'is_terminal')::boolean, false),
      case when coalesce((v_elem->>'is_terminal')::boolean, false) then nullif(v_elem->>'terminal_outcome', '') end,
      coalesce((v_elem->>'buying_opens_here')::boolean, false),
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
      buying_opens_here = excluded.buying_opens_here,
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
      id, stage_id, label, help, source, sor_field, field_type, options, is_required, sort_order, archived_at, created_at, updated_at, show_when, show_on_calendar
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
      now(),
      case when jsonb_typeof(v_elem->'show_when') = 'object' then v_elem->'show_when' end,
      coalesce((v_elem->>'show_on_calendar')::boolean, false)
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
      show_when = excluded.show_when,
      show_on_calendar = excluded.show_on_calendar,
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
         award_stage_id = v_award_stage_id,
         contract_stage_id = v_contract_stage_id,
         updated_at = now()
   where id = p_flow_id
  returning * into v_flow;

  return json_build_object('flow', row_to_json(v_flow), 'version', v_snapshot.version);
end;
$$;

grant execute on function public.restore_flow_snapshot(uuid, uuid) to authenticated;
