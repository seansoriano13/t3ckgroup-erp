-- #1096: HR Logs showed nothing for unpaid-leave and meeting-request actions.
-- The HR read policy listed 6 entity types, but the app's HR_ENTITY_TYPES has 8.
-- Add LWOP_LEAVE and MEETING_REQUEST. Only the select policy changes.
-- A test (hrAuditPolicyMatchesTypes.test.js) fails if the two lists drift.

drop policy if exists "hr_read_system_audit_logs" on public.system_audit_logs;
create policy "hr_read_system_audit_logs" on public.system_audit_logs
  as permissive
  for select
  to authenticated
  using (
    coalesce(public.is_hr(), false)
    and entity_type in ('EMPLOYEE','CATEGORY','OVERTIME','OFFSET_LEAVE','SIL_LEAVE','LWOP_LEAVE','MEETING_REQUEST','HR_SETTINGS')
  );
