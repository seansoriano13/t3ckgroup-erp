-- #327 (release/2026-09, #325): Stage Visits and Stage Participants were
-- readable by any signed-in employee (`using (true)`), so anyone could list
-- every SOR's Stage history and participant roster even when the SOR itself
-- was hidden from them. Narrow both reads to callers who can open the SOR:
-- `sor_access_level` of full (Deal Team, Always sees, Super Admin) or
-- participant (an open Stage Participant window). Same helper the tasks read
-- policy resolves through.
--
-- Two additions keep ADR 0021's locked view (a former participant) working
-- without widening it: a visit row sor_visible_visit_ids already hands the
-- caller (their own past window — getMyVisits), and the caller's own
-- participant rows. Neither shows anyone else's history or roster.
--
-- sor_access_level is security definer, so its own read of
-- sor_stage_participants is not filtered by the policy below (no recursion).

drop policy if exists sor_stage_visits_read on public.sor_stage_visits;
create policy sor_stage_visits_read on public.sor_stage_visits
  for select to authenticated
  using (
    public.sor_access_level(opportunity_id) in ('full', 'participant')
    or id in (select public.sor_visible_visit_ids(opportunity_id))
  );

drop policy if exists sor_stage_participants_read on public.sor_stage_participants;
create policy sor_stage_participants_read on public.sor_stage_participants
  for select to authenticated
  using (
    public.sor_access_level(opportunity_id) in ('full', 'participant')
    or employee_id = public.get_employee_id()
  );
