-- Group Tasks: "Awaiting Evaluation".
--
-- A Group Task whose members are all done now waits in AWAITING_EVALUATION until
-- its Evaluator rates it; "Completed" is left to tasks that are rated and handed
-- on. The app moves a task in and out of the status. This migration adds what the
-- app and the reminder job need to keep:
--
--   auto_evaluation            true for tasks created from now on: they move to
--                              Awaiting Evaluation on their own and are chased with
--                              reminders. Every task that exists today is set to
--                              false and keeps the old, manual flow.
--   awaiting_evaluation_at     when the task last entered Awaiting Evaluation.
--   evaluation_reminders_sent  0-3 reminders sent to the Evaluator, 4 once the
--                              creator and heads were told as well.
--
-- Then a one-time backfill: a task that is done but unrated moves to Awaiting
-- Evaluation. That is any task already COMPLETED (nothing in the app set it any
-- more, but old rows may carry it) and any ACTIVE task whose members are all
-- done. These tasks keep auto_evaluation = false, so they get no reminders.
--
-- send_group_task_evaluation_reminders() runs hourly. An Evaluator is reminded 3,
-- 6 and 9 days after the task arrived; at 12 days the creator and the heads of the
-- Evaluator's department are told once, and the chasing stops.

create extension if not exists pg_cron with schema extensions;

alter table public.committee_tasks add column if not exists auto_evaluation boolean not null default true;
alter table public.committee_tasks add column if not exists awaiting_evaluation_at timestamp with time zone;
alter table public.committee_tasks add column if not exists evaluation_reminders_sent integer not null default 0;

-- Rows that exist now follow the old flow; only tasks created after this get the new one.
update public.committee_tasks set auto_evaluation = false;

update public.committee_tasks ct
   set status = 'AWAITING_EVALUATION',
       awaiting_evaluation_at = coalesce(ct.updated_at, now())
 where ct.status = 'COMPLETED'
    or (
      ct.status = 'ACTIVE'
      and exists (select 1 from public.committee_task_members m where m.committee_task_id = ct.id)
      and not exists (
        select 1 from public.committee_task_members m
        where m.committee_task_id = ct.id and m.status <> 'DONE'
      )
    );

create or replace function public.send_group_task_evaluation_reminders()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_reminded integer;
  v_escalated integer;
begin
  with due as (
    update public.committee_tasks ct
       set evaluation_reminders_sent = ct.evaluation_reminders_sent + 1
     where ct.status = 'AWAITING_EVALUATION'
       and ct.auto_evaluation
       and ct.awaiting_evaluation_at is not null
       and ct.evaluation_reminders_sent < 3
       and ct.awaiting_evaluation_at + interval '3 days' * (ct.evaluation_reminders_sent + 1) <= now()
    returning ct.id, ct.title, ct.created_by, ct.evaluator_id
  ),
  ins as (
    insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
    select coalesce(d.evaluator_id, d.created_by),
           null,
           'GROUP_TASK_EVALUATION_REMINDER',
           'Group task still needs your rating',
           format('"%s" is done and still waiting for you to rate it.', d.title),
           d.id
      from due d
    returning 1
  )
  select count(*) into v_reminded from ins;

  with escalated as (
    update public.committee_tasks ct
       set evaluation_reminders_sent = 4
     where ct.status = 'AWAITING_EVALUATION'
       and ct.auto_evaluation
       and ct.awaiting_evaluation_at is not null
       and ct.evaluation_reminders_sent = 3
       and ct.awaiting_evaluation_at + interval '12 days' <= now()
    returning ct.id, ct.title, ct.created_by, coalesce(ct.evaluator_id, ct.created_by) as evaluator_id
  ),
  people as (
    select x.id as task_id, x.title, x.evaluator_id, x.created_by as person_id
      from escalated x
    union
    select x.id, x.title, x.evaluator_id, h.id
      from escalated x
      join public.employees ev on ev.id = x.evaluator_id
      join public.employees h
        on h.is_head
       and not coalesce(h.is_deleted, false)
       and h.department = ev.department
  ),
  ins as (
    insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
    select p.person_id,
           null,
           'GROUP_TASK_EVALUATION_REMINDER',
           'Group task is still not rated',
           format('"%s" has waited 12 days for %s to rate it.', p.title, coalesce(ev.name, 'its evaluator')),
           p.task_id
      from people p
      left join public.employees ev on ev.id = p.evaluator_id
     where p.person_id <> p.evaluator_id
    returning 1
  )
  select count(*) into v_escalated from ins;

  return coalesce(v_reminded, 0) + coalesce(v_escalated, 0);
end;
$function$;

revoke all on function public.send_group_task_evaluation_reminders() from public, anon, authenticated;

select cron.unschedule(jobname)
from cron.job
where jobname = 'group-task-evaluation-reminders';

select cron.schedule(
  'group-task-evaluation-reminders',
  '7 * * * *', -- hourly
  $$select public.send_group_task_evaluation_reminders();$$
);
