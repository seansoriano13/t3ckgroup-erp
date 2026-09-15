-- `tasks_broadcast_change_trigger` (0027, baseline schema) fires AFTER every
-- insert/update/delete on public.tasks and calls realtime.send() with no
-- error handling. Locally Realtime is deliberately disabled (issue #87,
-- supabase/config.toml) because its CLI image ships a broken
-- libapparmor.so.1 — so realtime.send() doesn't exist at all there, and the
-- trigger's failure rolls back the entire task write. Every local task
-- creation was silently broken by this, Stage Action automations included.
--
-- Wrapping the broadcast in its own exception handler keeps the write safe
-- everywhere: real Realtime (staging/prod) still gets its broadcast exactly
-- as before, and a transient Realtime outage anywhere never blocks the
-- actual data change a broadcast is only ever a notification about.
create or replace function public.tasks_broadcast_change()
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
      'tasks-changes',
      true -- private: gated by the realtime.messages policy above, not public
    );
  exception when others then
    null;
  end;
  return null;
end;
$function$;
