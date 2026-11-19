-- #1094 (spec #1093, tracker A1): the audit log accepts a row only when it is
-- written as the signed-in employee. The old rule let any signed-in user write a
-- row as anyone, or as "System" (no author).
--
-- Rows with no author are written by security definer functions (the revert and
-- resume stage RPCs), which run as the function owner and are not checked by
-- this rule. The browser can no longer write them.
--
-- Prod: safe to apply. It only narrows the insert rule; no rows change. The
-- Super Admin "all" rule is untouched.

drop policy if exists "authenticated_insert_system_audit_logs" on public.system_audit_logs;

create policy "authenticated_insert_system_audit_logs" on public.system_audit_logs
  as permissive
  for insert
  to authenticated
  with check (author_id is not null and author_id = public.get_employee_id());
