-- Issue #294 (part of #208, ADR 0021) — Stage Participant access windows.
--
-- A Stage Participant is opened by a call-in (an action task, an Assignment
-- condition, or day-one registration — Purchase Request wiring is #209's
-- job, but the source enum and this table accommodate it already) and closed
-- by a Stage Visit move per the window's own rule. `opened_visit_id` doubles
-- as "which Stage called this person in" — the visit's `flow_stage_id` IS the
-- calling Stage, so there is no separate calling_stage_id column to keep in
-- sync.
--
-- Closing is a trigger, mirroring `record_stage_visit()`
-- (20260915030000_stage_fields_and_visits.sql): a participant's access must
-- never survive past the move that was supposed to end it, so the write that
-- can't be forgotten is done by the database, not by whichever caller moves
-- the Stage. Reaching a Terminal Stage always closes every open window for
-- that SOR, regardless of each row's own rule.

create table if not exists public.sor_stage_participants (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.sales_opportunities (id) on delete cascade,
  employee_id     uuid not null references public.employees (id),
  source          text not null,
  source_id       uuid,
  opened_visit_id uuid not null references public.sor_stage_visits (id),
  until_rule      text not null,
  until_stage_id  uuid references public.flow_stages (id),
  closed_at       timestamptz,
  closed_reason   text,
  removed_by      uuid references public.employees (id),
  created_at      timestamptz not null default now(),

  constraint sor_stage_participants_source_chk check (source in ('action', 'assignment', 'purchase_request')),
  constraint sor_stage_participants_until_rule_chk check (
    until_rule in ('stage_left', 'stage_entered', 'later_stage_left', 'terminal')
  )
  -- `until_stage_id` is required for "stage_entered"/"later_stage_left" and
  -- null otherwise; that pairing is enforced in
  -- sorStageParticipantService.openWindow rather than as a second CHECK
  -- here, alongside the other conditional rules (source/source_id, e.g.)
  -- that are also application-level.
);

create index if not exists sor_stage_participants_opportunity_id_idx
  on public.sor_stage_participants (opportunity_id);
create index if not exists sor_stage_participants_open_idx
  on public.sor_stage_participants (opportunity_id) where closed_at is null;

alter table public.sor_stage_participants enable row level security;

drop policy if exists sor_stage_participants_read on public.sor_stage_participants;
create policy sor_stage_participants_read on public.sor_stage_participants
  for select to authenticated
  using (true);

-- Insert happens wherever a call-in happens (action task creation, an
-- Assignment condition being satisfied, day-one registration) — the same
-- open-write model as stage_conditions/flow_stage_fields, not a
-- security-definer-only table like sor_stage_visits, because the caller here
-- is an ordinary authenticated employee acting on the deal they're already
-- allowed to write to.
drop policy if exists sor_stage_participants_insert on public.sor_stage_participants;
create policy sor_stage_participants_insert on public.sor_stage_participants
  for insert to authenticated
  with check (true);

-- Update is narrower: only the Deal Owner or a Super Admin may close a
-- window by hand (removeParticipant). The rule-driven close above runs as
-- the trigger's own definer and bypasses RLS entirely, so it never needs
-- this policy to pass.
drop policy if exists sor_stage_participants_update on public.sor_stage_participants;
create policy sor_stage_participants_update on public.sor_stage_participants
  for update to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.sales_opportunities o
      where o.id = sor_stage_participants.opportunity_id
        and o.deal_owner_id = public.get_employee_id()
    )
  );

create or replace function public.close_stage_participant_windows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_terminal boolean;
begin
  if NEW.flow_stage_id is not distinct from OLD.flow_stage_id then
    return NEW;
  end if;

  select is_terminal into v_is_terminal from public.flow_stages where id = NEW.flow_stage_id;

  if v_is_terminal then
    update public.sor_stage_participants
      set closed_at = now(), closed_reason = 'terminal'
      where opportunity_id = NEW.id and closed_at is null;
    return NEW;
  end if;

  update public.sor_stage_participants p
    set closed_at = now(), closed_reason = 'rule_met'
    from public.sor_stage_visits v
    where p.opportunity_id = NEW.id
      and p.closed_at is null
      and p.opened_visit_id = v.id
      and (
        (p.until_rule = 'stage_left' and v.flow_stage_id = OLD.flow_stage_id)
        or (p.until_rule = 'stage_entered' and p.until_stage_id = NEW.flow_stage_id)
        or (p.until_rule = 'later_stage_left' and p.until_stage_id = OLD.flow_stage_id)
      );

  return NEW;
end;
$$;

drop trigger if exists sor_stage_participants_on_stage_change on public.sales_opportunities;
create trigger sor_stage_participants_on_stage_change
  after update of flow_stage_id on public.sales_opportunities
  for each row execute function public.close_stage_participant_windows();
