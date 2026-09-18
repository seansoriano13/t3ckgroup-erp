-- Issue #204 Part 3 — Follow-up Cadence.
--
-- A Stage setting in the General tab (issue #203): on/off, every N days,
-- recipients (people-picker selectors, resolvePeople.js's shape), and
-- "Proof required". One row per Stage, mirroring flow_stage_fields'/
-- stage_conditions' shape and policies (open read, open write — Flow Canvas
-- access control is opened per requireSuperAdmin's comment in
-- stageFieldService.js/followUpService.js).
--
-- The cadence itself is carried in the SOR's own published Flow Snapshot
-- (snapshot_data->'followUps', keyed by stage id, written by
-- buildDraftSnapshotData in constants/salesFlow.js) — the same "pinned to
-- what was true when this SOR registered" rule every other Flow Canvas
-- setting already follows. `sor_due_follow_ups` below reads the snapshot,
-- never this live table, for exactly that reason.

create table if not exists public.flow_stage_follow_ups (
  stage_id       uuid primary key references public.flow_stages (id) on delete cascade,
  enabled        boolean not null default false,
  every_days     integer check (every_days is null or every_days > 0),
  recipients     jsonb not null default '[{"type":"role","role":"deal_owner"}]'::jsonb,
  proof_required boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint flow_stage_follow_ups_days_when_enabled check (not enabled or every_days is not null)
);

alter table public.flow_stage_follow_ups enable row level security;

drop policy if exists flow_stage_follow_ups_read on public.flow_stage_follow_ups;
create policy flow_stage_follow_ups_read on public.flow_stage_follow_ups
  for select to authenticated
  using (true);

-- Access control opened, matching stage_conditions_write/flow_stage_fields_write:
-- anyone can edit Flow Canvas (requireSuperAdmin in followUpService.js is a no-op).
drop policy if exists flow_stage_follow_ups_write on public.flow_stage_follow_ups;
create policy flow_stage_follow_ups_write on public.flow_stage_follow_ups
  for all to authenticated
  using (true)
  with check (true);

-- ─── sor_due_follow_ups(p_now) ───────────────────────────────────────────────
--
-- One row per open Stage Visit (left_at is null) whose SOR's own published
-- Flow Snapshot carries an enabled cadence for that visit's Stage, where the
-- next reminder is due at or before p_now. Mirrors nextFollowUpDue in
-- src/constants/followUp.js literally: due = greatest(entered_at, last
-- FOLLOW_UP_LOGGED, last FOLLOW_UP_REMINDER for this visit) + every_days.
--
-- Reads follow-up config from the SNAPSHOT, not the live
-- flow_stage_follow_ups table — a change to the live table only takes
-- effect for SORs on a later Flow Snapshot, same as every other Stage
-- setting (conditions, fields, actions).
create or replace function public.sor_due_follow_ups(p_now timestamptz default now())
returns table (
  opportunity_id  uuid,
  stage_visit_id  uuid,
  stage_id        uuid,
  entered_at      timestamptz,
  every_days      integer,
  recipients      jsonb,
  due_at          timestamptz
)
language sql
stable
set search_path = public
as $$
  with open_visits as (
    select
      v.id as stage_visit_id,
      v.opportunity_id,
      v.flow_stage_id as stage_id,
      v.entered_at,
      so.flow_snapshot_id
    from public.sor_stage_visits v
    join public.sales_opportunities so on so.id = v.opportunity_id
    where v.left_at is null
  ),
  cadences as (
    select
      ov.*,
      fu.value as follow_up_cfg
    from open_visits ov
    join public.flow_snapshots fs on fs.id = ov.flow_snapshot_id
    cross join lateral jsonb_array_elements(coalesce(fs.snapshot_data->'followUps', '[]'::jsonb)) as fu(value)
    where fu.value->>'id' = ov.stage_id::text
      and (fu.value->>'enabled')::boolean is true
      and (fu.value->>'everyDays') is not null
  ),
  last_logged as (
    select
      (metadata->>'stageVisitId')::uuid as stage_visit_id,
      max(created_at) as last_at
    from public.sales_opportunity_logs
    where metadata->>'event' = 'FOLLOW_UP_LOGGED'
    group by 1
  ),
  last_reminder as (
    select
      (metadata->>'stageVisitId')::uuid as stage_visit_id,
      max(created_at) as last_at
    from public.sales_opportunity_logs
    where metadata->>'event' = 'FOLLOW_UP_REMINDER'
    group by 1
  )
  select
    c.opportunity_id,
    c.stage_visit_id,
    c.stage_id,
    c.entered_at,
    (c.follow_up_cfg->>'everyDays')::integer as every_days,
    coalesce(c.follow_up_cfg->'recipients', '[]'::jsonb) as recipients,
    greatest(c.entered_at, coalesce(ll.last_at, c.entered_at), coalesce(lr.last_at, c.entered_at))
      + ((c.follow_up_cfg->>'everyDays')::integer) * interval '1 day' as due_at
  from cadences c
  left join last_logged ll on ll.stage_visit_id = c.stage_visit_id
  left join last_reminder lr on lr.stage_visit_id = c.stage_visit_id
  where
    greatest(c.entered_at, coalesce(ll.last_at, c.entered_at), coalesce(lr.last_at, c.entered_at))
      + ((c.follow_up_cfg->>'everyDays')::integer) * interval '1 day' <= p_now;
$$;
