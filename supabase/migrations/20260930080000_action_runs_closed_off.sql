-- Issue #385 (parent #384) — an action run can be closed off.
-- Fire-once moves from "one run per (SOR, Stage, Action) ever" to "one LIVE
-- run": a closed-off run no longer blocks a new one. Nothing closes a run off
-- yet, so behaviour is unchanged. Every existing run is live (closed_off_at
-- null).

alter table public.sor_action_runs
  add column if not exists closed_off_at timestamptz;
alter table public.sor_action_runs
  add column if not exists closed_off_reason text;

alter table public.sor_action_runs
  drop constraint if exists sor_action_runs_unique;

create unique index if not exists sor_action_runs_live_unique
  on public.sor_action_runs (opportunity_id, stage_id, action_id)
  where closed_off_at is null;

-- The fire-once gate: upsert-if-absent among LIVE runs only.
create or replace function public.sor_begin_action_run(
  p_opportunity_id uuid,
  p_stage_id uuid,
  p_action_id uuid,
  p_stage_visit_id uuid default null,
  p_decider jsonb default null
) returns public.sor_action_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sor_action_runs;
begin
  insert into public.sor_action_runs (opportunity_id, stage_id, action_id, stage_visit_id, decider)
  values (p_opportunity_id, p_stage_id, p_action_id, p_stage_visit_id, p_decider)
  on conflict (opportunity_id, stage_id, action_id) where closed_off_at is null do nothing;

  select * into v_row
  from public.sor_action_runs
  where opportunity_id = p_opportunity_id
    and stage_id = p_stage_id
    and action_id = p_action_id
    and closed_off_at is null;

  return v_row;
end;
$$;
