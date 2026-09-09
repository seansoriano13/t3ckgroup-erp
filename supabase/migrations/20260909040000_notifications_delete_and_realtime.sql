-- #169: Fix the notification table's two latent defects.
--
-- 1. There is no DELETE policy on notifications. RLS with no matching policy
--    denies by default, so `notificationService.deleteNotification` matches
--    zero rows, returns success, the drawer optimistically drops the item,
--    and it reappears on the next fetch. Add a policy scoped to the
--    recipient, matching the existing read/update policies.
--
-- 2. The notifications table was never added to the supabase_realtime
--    publication in any migration, so whatever makes today's live
--    subscription work was configured outside the repository and cannot be
--    reproduced from it. Add it here, guarded so this is safe to re-run.
--
-- Also narrows the insert policy: "Anyone can dispatch a notification" was
-- `to public with check (true)` — open to anonymous callers, and to any
-- authenticated client claiming to be any sender. Notifying someone else is
-- a legitimate, common operation (assigning a task, broadcasting to a role)
-- and stays allowed; what narrows is that a caller can no longer name a
-- sender other than themselves.

drop policy if exists "Anyone can dispatch a notification" on public.notifications;

create policy "Authenticated users can dispatch a notification as themselves"
  on public.notifications
  for insert
  to authenticated
  with check (sender_id is null or sender_id = get_employee_id());

create policy "Users can delete own notifications"
  on public.notifications
  for delete
  to public
  using (recipient_id = get_employee_id());

alter table public.notifications replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
