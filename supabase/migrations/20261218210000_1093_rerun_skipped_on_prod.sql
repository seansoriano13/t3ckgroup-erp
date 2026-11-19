-- Spec #1093: on prod, a ledger repair marked 20261218150000 (audit log realtime) and
-- 20261218200000 (drop prod-only open reads) as applied without running them. This repeats
-- both, idempotently. On staging and from empty it is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'system_audit_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.system_audit_logs;
  END IF;
END $$;

drop policy if exists "Allow all read" on public.system_audit_logs;
drop policy if exists "Authenticated users can read task activity" on public.task_activity;
