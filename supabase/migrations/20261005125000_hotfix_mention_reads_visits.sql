-- allow-out-of-order: prod hotfix; must sort before 20261005131300_mention_window.sql, which supersedes it.
-- Prod hotfix: a mentioned person can read and post notes on the SOR.
--
-- 20261001140000 made a mention a 'participant' grant on any SOR, but
-- sor_visible_visit_ids never read sor_mention_viewers. On an SOR with Stage
-- Visits the mentioned person saw an empty timeline, and posting a note failed
-- with "new row violates row-level security policy" (the insert's RETURNING
-- goes through sor_log_read).
--
-- Interim and deliberately wide: every visit of the SOR. Superseded by
-- 20261005131300_mention_window.sql, which narrows it to the visit the
-- Mention was made on. Keep this file's timestamp before that one.

-- Guarded: once mention_window has run (sor_mention_viewers.stage_visit_id
-- exists) this is a no-op, so applying it late (staging) cannot undo the
-- narrower function.

do $hotfix$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sor_mention_viewers'
      and column_name = 'stage_visit_id'
  ) then
    return;
  end if;

  execute $sql$
create or replace function public.sor_visible_visit_ids(p_opportunity_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select v.id
  from public.sor_stage_visits v
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and public.is_super_admin()

  union

  select v.id
  from public.sor_stage_visits v
  join public.sales_opportunities o on o.id = v.opportunity_id
  where v.opportunity_id = p_opportunity_id
    and v.undone_at is null
    and not public.is_super_admin()
    and (
      public.sor_is_deal_team(o, public.get_employee_id())
      or public.sor_always_sees(o, public.get_employee_id())
    )
    and not public.sor_is_stage_shut_out(o, public.get_employee_id(), v.flow_stage_id)

  union

  select v.id
  from public.sor_stage_participants p
  join public.sor_stage_visits opened on opened.id = p.opened_visit_id
  join public.sor_stage_visits v on v.opportunity_id = p.opportunity_id
  where p.opportunity_id = p_opportunity_id
    and p.employee_id = public.get_employee_id()
    and not public.is_super_admin()
    and opened.undone_at is null
    and v.undone_at is null
    and (
      (p.closed_at is null and v.sequence >= opened.sequence)
      or (
        p.closed_at is not null
        and v.sequence >= opened.sequence
        and v.sequence <= (
          select max(closing.sequence)
          from public.sor_stage_visits closing
          where closing.opportunity_id = p.opportunity_id
            and closing.sequence >= opened.sequence
            and closing.left_at is not null
            and closing.left_at <= p.closed_at
        )
      )
    )

  union

  -- Mentioned in: every visit of the SOR (hotfix, see header).
  select v.id
  from public.sor_mention_viewers m
  join public.sor_stage_visits v on v.opportunity_id = m.opportunity_id
  where m.opportunity_id = p_opportunity_id
    and m.employee_id = public.get_employee_id()
    and not public.is_super_admin()
    and v.undone_at is null
$$
  $sql$;
end
$hotfix$;
