-- #1100: make the Activity Log LIVE badge true.
-- Adds system_audit_logs to the realtime publication (System, SOR and HR tabs).
-- task_activity is deliberately NOT added: it is a large, high-write table and
-- every insert would be RLS-checked per subscriber (and its read rule is being
-- tightened in #1097). Task Logs drops its LIVE badge instead.
-- Idempotent. Prod: apply per ADR 0008 with the normal migration deploy.
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
