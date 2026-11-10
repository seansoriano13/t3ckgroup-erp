-- #629 (spec #609): remind people 15 minutes before an approved Meeting Request.
--
-- send_meeting_reminders() finds APPROVED requests that start within the next
-- 15 minutes and have no reminder_sent_at, stamps them, and notifies the
-- applicant, the Facilitator and every Participant once each (someone holding
-- two roles gets one notification). Declined, cancelled, pending, returned,
-- already-started and further-than-15-minutes meetings are never touched.
-- Stamping and notifying happen in one statement, so a second run finds nothing.
-- The notification insert fires the existing push path (type MEETING_REMINDER).
--
-- An edit that changes the time clears reminder_sent_at (#628's edit function).
--
-- Written as a file only. Apply it through the normal staging/prod path.

create extension if not exists pg_cron with schema extensions;

create or replace function public.send_meeting_reminders()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  with due as (
    update public.meeting_requests r
       set reminder_sent_at = now()
     where r.status = 'APPROVED'
       and r.reminder_sent_at is null
       and r.starts_at > now()
       and r.starts_at <= now() + interval '15 minutes'
    returning r.id, r.applicant_id, r.facilitator_id, r.venue_id, r.starts_at, r.purpose
  ),
  people as (
    select d.id as request_id, d.applicant_id as person_id from due d
    union
    select d.id, d.facilitator_id from due d
    union
    select d.id, p.employee_id
      from due d
      join public.meeting_request_participants p on p.request_id = d.id
  ),
  ins as (
    insert into public.notifications (recipient_id, sender_id, type, title, message, reference_id)
    select pe.person_id,
           null,
           'MEETING_REMINDER',
           'Meeting starts soon',
           format('%s, %s: %s',
                  coalesce(v.name, 'Venue'),
                  to_char(d.starts_at at time zone 'Asia/Manila', 'Mon FMDD, FMHH12:MI AM'),
                  d.purpose),
           d.id
      from people pe
      join due d on d.id = pe.request_id
      left join public.calendar_venues v on v.id = d.venue_id
    returning 1
  )
  select count(*) into v_count from ins;

  return coalesce(v_count, 0);
end;
$function$;

revoke all on function public.send_meeting_reminders() from public, anon, authenticated;

select cron.unschedule(jobname)
from cron.job
where jobname = 'meeting-reminders';

select cron.schedule(
  'meeting-reminders',
  '*/5 * * * *', -- every 5 minutes
  $$select public.send_meeting_reminders();$$
);
