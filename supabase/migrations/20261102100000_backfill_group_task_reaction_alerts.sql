-- #648: reaction alerts from Group Task chats used to be written as
-- TASK_REACTION, which routed to Task Approvals and failed. New ones are
-- GROUP_TASK_REACTION; re-type the old ones whose reference is a Group Task.
-- notifications.type is plain varchar (no CHECK or enum), so no constraint change.
update public.notifications n
set type = 'GROUP_TASK_REACTION'
where n.type = 'TASK_REACTION'
  and exists (
    select 1 from public.committee_tasks c where c.id::text = n.reference_id
  );
