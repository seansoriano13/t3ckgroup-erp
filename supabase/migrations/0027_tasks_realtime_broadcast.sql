-- Migration 0027: Broadcast task changes over Supabase Realtime
--
-- Unlike migrations 0020/0021 (sor_procurement_requests, sales_opportunity_logs),
-- this does NOT add `tasks` to the postgres_changes publication. `tasks` carries
-- approval grades and HR verification notes and has no row-level security
-- policy today, so a postgres_changes subscription would hand every field of
-- every task to any authenticated client that happens to be subscribed,
-- regardless of what that client's own queries are scoped to.
--
-- Instead, an AFTER trigger broadcasts a minimal "something changed" signal —
-- just the row id and operation, never column values — over Realtime
-- Broadcast. Clients treat it as a nudge to refetch, not as data. See
-- docs/realtime-policy.md.
--
-- No REPLICA IDENTITY change is needed: unlike postgres_changes (which reads
-- OLD/NEW off the WAL and needs REPLICA IDENTITY FULL to get full row data
-- there), a broadcast-from-trigger reads OLD/NEW directly off the trigger's
-- own row, which Postgres always provides regardless of replica identity.
--
-- SAFE TO RUN AT ANY TIME:
--   * The realtime.messages policy is created only if it doesn't already exist.
--   * The trigger function is CREATE OR REPLACE; the trigger itself is dropped
--     and recreated, so re-running this migration is a no-op in effect.

-- Realtime Authorization is on by default for Broadcast: a client can only
-- receive from a topic if it can SELECT the corresponding row in
-- realtime.messages. This policy scopes that to "signed in", not "public" —
-- fine here because the broadcast payload itself carries no task data.
do $$
begin
  if not exists (
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

create or replace function public.tasks_broadcast_change()
returns trigger
security definer set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', coalesce(new.id, old.id)),
    tg_op,
    'tasks-changes',
    true -- private: gated by the realtime.messages policy above, not public
  );
  return null;
end;
$$ language plpgsql;

drop trigger if exists tasks_broadcast_change_trigger on public.tasks;

create trigger tasks_broadcast_change_trigger
after insert or update or delete on public.tasks
for each row execute function public.tasks_broadcast_change();
