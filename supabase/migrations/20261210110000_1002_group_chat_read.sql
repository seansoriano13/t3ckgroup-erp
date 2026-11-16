-- #1002 (spec #1000, tracker A2): Group Task chat messages follow the Group Task's read rule.
--
-- committee_task_activity had "Enable read access for all users" using (true), so every signed-in employee
-- could read every Group Task chat, including Group Tasks on Restricted Stages (ADR 0021). The read rule is
-- now the same one the Group Task itself uses: committee_task_visible(task_id) (creator, evaluator, member,
-- super admin, plus the ON_HOLD head rule). No new access rule. Insert and update rules are not touched.
--
-- Local policy matched the baseline before this change (select true). The chat list
-- (get_user_active_chats) still returns a member's own chats, because a member
-- passes committee_task_visible; see src/test/policy/1000-chat-list-speed.test.js.
--
-- SAFE TO RUN AT ANY TIME. Idempotent.

drop policy if exists "Enable read access for all users" on public.committee_task_activity;
drop policy if exists "Group Task chat follows the Group Task read rule" on public.committee_task_activity;

create policy "Group Task chat follows the Group Task read rule" on public.committee_task_activity
  as permissive
  for select
  to public
  using (public.committee_task_visible(task_id));
