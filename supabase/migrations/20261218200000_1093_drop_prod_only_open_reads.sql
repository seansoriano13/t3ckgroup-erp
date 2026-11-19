-- Spec #1093: production carries two open read policies under names that staging never had,
-- so the #1094 and #1097 migrations (which drop the staging names) would leave them in place.
-- "Allow all read" lets anyone read the whole audit log; "Authenticated users can read task
-- activity" lets every employee read every task's chat. Both are permissive, so while they exist
-- the tightened rules do nothing. Drop them if present; on staging (and from empty) this is a no-op.

drop policy if exists "Allow all read" on public.system_audit_logs;
drop policy if exists "Authenticated users can read task activity" on public.task_activity;
