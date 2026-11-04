-- Technical team (RRD / IOE) entry point for the S0 Evaluation.
--
-- WHY: a Technical person (a member of costing_signer_lists 'team_rrd' / 'team_ioe') can judge the
-- rows of their team on a sheet, but nothing led them to it: the S0 Evaluation page is the Closed Book's
-- (it shows money), and a Technical person is on no Deal Team so the SOR is not on any list they can open.
--
-- WHAT THIS ADDS (no money anywhere, no change to who may write a verdict):
--   * costing_technical_list(): one row per SOR and team the caller is on, with how many rows are judged
--     and whether the Evaluation of Specification is approved. SOR name and counts only. A Super Admin
--     sees every team's rows (is_mine says which are theirs to judge).
--   * A trigger on costing_tender_lines: when a row is given to a team, the team's members get one
--     'COSTING_EVALUATION_ASSIGNED' notification per SOR and team (an unread one is not repeated).
--
-- SAFE TO RUN AT ANY TIME: one new read-only function, one new function and trigger that only add
-- notifications. Idempotent.

drop function if exists public.costing_technical_list();
create function public.costing_technical_list()
returns table (
  opportunity_id uuid,
  sor_code text,
  sales_reference text,
  project_title text,
  client_name text,
  stage text,
  team text,
  rows_total integer,
  rows_judged integer,
  approved boolean,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.get_employee_id();
  v_all boolean := coalesce(public.is_super_admin(), false);
begin
  if v_me is null then
    raise exception 'costing_technical_list: not signed in' using errcode = '42501';
  end if;
  if not (v_all or exists (
    select 1 from public.costing_signer_lists l
    join public.employees e on e.id = l.employee_id
    where l.employee_id = v_me and l.list_key in ('team_rrd', 'team_ioe') and not coalesce(e.is_deleted, false)
  )) then
    raise exception 'costing_technical_list: only the RRD and IOE teams and Super Admins read the Technical list'
      using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.sor_code,
    o.sales_reference,
    o.project_title,
    o.client_name,
    fs.name,
    t.evaluating_team,
    count(c.id)::integer,
    (count(c.id) filter (where c.compliance is not null))::integer,
    exists (
      select 1 from public.costing_signoffs s
      where s.matrix_id = m.id and s.role = 'evaluation_approved' and s.cleared_at is null
    ),
    -- Whether the caller is on this row's team: a Super Admin reads every team's rows but judges only their own.
    exists (
      select 1 from public.costing_signer_lists l
      where l.employee_id = v_me and l.list_key = 'team_' || lower(t.evaluating_team)
    )
  from public.costing_matrices m
  join public.sales_opportunities o on o.id = m.opportunity_id
  join public.costing_tender_lines t on t.matrix_id = m.id and t.evaluating_team is not null
  left join public.costing_components c on c.tender_line_id = t.id
  left join public.flow_stages fs on fs.id = o.flow_stage_id
  where not coalesce(o.is_deleted, false)
    and not coalesce(o.is_scratch, false)
    and (
      v_all
      or exists (
        select 1 from public.costing_signer_lists l
        where l.employee_id = v_me and l.list_key = 'team_' || lower(t.evaluating_team)
      )
    )
  group by o.id, o.sor_code, o.sales_reference, o.project_title, o.client_name, o.serial_no, fs.name, t.evaluating_team, m.id
  order by o.serial_no desc, t.evaluating_team;
end;
$$;

revoke all on function public.costing_technical_list() from public, anon;
grant execute on function public.costing_technical_list() to authenticated;

-- Tells a team its rows are waiting: once per SOR and team, until the notice is read.
create or replace function public._costing_notify_evaluation_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp uuid;
  v_sor text;
  v_project text;
  v_message text;
  r record;
begin
  if new.evaluating_team is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.evaluating_team is not distinct from old.evaluating_team then
    return new;
  end if;

  select o.id, o.sor_code, o.project_title into v_opp, v_sor, v_project
    from public.costing_matrices m
    join public.sales_opportunities o on o.id = m.opportunity_id
   where m.id = new.matrix_id;
  if v_opp is null then
    return new;
  end if;

  v_message := coalesce(v_sor, 'An SOR') || ' · ' || coalesce(v_project, '') || ': rows are waiting for ' ||
               new.evaluating_team || ' to judge.';

  for r in
    select l.employee_id
      from public.costing_signer_lists l
      join public.employees e on e.id = l.employee_id
     where l.list_key = 'team_' || lower(new.evaluating_team)
       and not coalesce(e.is_deleted, false)
       and l.employee_id is distinct from public.get_employee_id()
  loop
    if not exists (
      select 1 from public.notifications n
       where n.recipient_id = r.employee_id
         and n.type = 'COSTING_EVALUATION_ASSIGNED'
         and n.reference_id = v_opp::text
         and n.title = 'Rows waiting for ' || new.evaluating_team
         and coalesce(n.is_read, false) = false
    ) then
      insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
      values (r.employee_id, public.get_employee_id(), 'COSTING_EVALUATION_ASSIGNED',
              'Rows waiting for ' || new.evaluating_team, v_message, v_opp::text);
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public._costing_notify_evaluation_team() from public, anon, authenticated;

drop trigger if exists costing_tender_lines_notify_team on public.costing_tender_lines;
create trigger costing_tender_lines_notify_team
  after insert or update of evaluating_team on public.costing_tender_lines
  for each row execute function public._costing_notify_evaluation_team();
