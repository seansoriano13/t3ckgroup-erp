-- #627 (spec #609): live Calendar updates for Meeting Requests.
--
-- Both tables are readable by every signed-in employee (#619), so there is nothing
-- here a subscriber could not already fetch; the client only needs a nudge to
-- refetch. Per docs/realtime-policy.md that is the shared `useTableRealtime` hook,
-- which listens to a Broadcast channel `<table>-changes`. Each table broadcasts the
-- row id (never a column) from a trigger, the same pattern and the same
-- realtime.messages policy as tasks, sales_opportunities and retail_orders.
-- Time Off tables are deliberately NOT live (they refresh on window focus and after
-- the viewer's own actions).
--
-- Re-runnable: policy guarded, functions are CREATE OR REPLACE, triggers are dropped
-- and recreated.

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages')
     and not exists (
       select 1 from pg_policies
       where schemaname = 'realtime' and tablename = 'messages'
         and policyname = 'authenticated can receive broadcasts'
     ) then
    create policy "authenticated can receive broadcasts"
      on "realtime"."messages"
      for select
      to authenticated
      using (true);
  end if;
end $$;

-- Wrapped in its own exception handler, like tasks_broadcast_change: a broadcast
-- failure must never roll back the write it is only a notification about.
create or replace function public.meeting_requests_broadcast_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', coalesce(new.id, old.id)),
      tg_op,
      'meeting_requests-changes',
      true -- private: gated by the realtime.messages policy, not public
    );
  exception when others then
    null;
  end;
  return null;
end;
$function$;

create or replace function public.meeting_request_participants_broadcast_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', coalesce(new.request_id, old.request_id)),
      tg_op,
      'meeting_request_participants-changes',
      true
    );
  exception when others then
    null;
  end;
  return null;
end;
$function$;

drop trigger if exists meeting_requests_broadcast_change_trigger on public.meeting_requests;
create trigger meeting_requests_broadcast_change_trigger
after insert or update or delete on public.meeting_requests
for each row execute function public.meeting_requests_broadcast_change();

drop trigger if exists meeting_request_participants_broadcast_change_trigger on public.meeting_request_participants;
create trigger meeting_request_participants_broadcast_change_trigger
after insert or update or delete on public.meeting_request_participants
for each row execute function public.meeting_request_participants_broadcast_change();
