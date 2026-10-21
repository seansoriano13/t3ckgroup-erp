-- #627 (spec #609): live Calendar updates for Meeting Requests.
--
-- Both tables already let every signed-in employee read every row (#619), so per
-- docs/realtime-policy.md they use postgres_changes through the supabase_realtime
-- publication; the read policy still decides who receives each row. Time Off tables
-- are deliberately NOT added (they refresh on window focus and after the viewer's own actions).
--
-- Re-runnable: each add is guarded.

alter table public.meeting_requests replica identity full;
alter table public.meeting_request_participants replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['meeting_requests', 'meeting_request_participants'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
