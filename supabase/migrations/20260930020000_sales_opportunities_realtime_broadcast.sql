-- Live SORS Board: tell every open register that an SOR changed.
--
-- Two people can move the same SOR — or one moves it while another is reading
-- the column it just left — and each sees stale state until they refresh
-- (docs/realtime-policy.md: concurrency risk, and the Board is where people
-- watch cards move).
--
-- Broadcast from a trigger, NOT `postgres_changes`, even though this table has
-- RLS. `sor_read` calls `sor_is_deal_team` and `sor_always_sees`, and
-- postgres_changes would re-run it for every change for every subscriber on
-- Realtime's RLS thread. All the register needs is a nudge to refetch through
-- the same RLS-filtered query it already uses, so the signal carries only the
-- row id and operation — never a column — the same contract `tasks` has.
--
-- The realtime.messages policy is what lets a signed-in client receive on a
-- private topic; `tasks` already created it on staging and prod. It is
-- guarded twice here: not recreated if present, and skipped if the Realtime
-- service has not yet made `realtime.messages` at all (a local stack, where
-- scripts/local-realtime.mjs creates it after the service's own migrations).
--
-- Wrapped in its own exception handler, like tasks_broadcast_change
-- (20260915070000): where `realtime.send` does not exist, a broadcast failure
-- must never roll back the SOR write it is only a notification about.
--
-- SAFE TO RUN AT ANY TIME: the function is CREATE OR REPLACE, the trigger is
-- dropped and recreated.

do $$
begin
  if to_regclass('realtime.messages') is not null
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

create or replace function public.sales_opportunities_broadcast_change()
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
      'sales_opportunities-changes',
      true -- private: gated by the realtime.messages policy, not public
    );
  exception when others then
    null;
  end;
  return null;
end;
$function$;

drop trigger if exists sales_opportunities_broadcast_change_trigger on public.sales_opportunities;

create trigger sales_opportunities_broadcast_change_trigger
after insert or update or delete on public.sales_opportunities
for each row execute function public.sales_opportunities_broadcast_change();
