-- Technical notice wording: "to check" instead of "to judge" (#877). Only the message text changes; the unread
-- check still goes by recipient, type, SOR and title, so an unread notice with the old wording is not repeated.
--
-- SAFE TO RUN AT ANY TIME: replaces one trigger function body. Idempotent.

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
               new.evaluating_team || ' to check.';

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
