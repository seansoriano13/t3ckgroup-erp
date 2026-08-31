-- Add UPDATE RLS policies so Supabase Realtime can broadcast reaction UPDATE
-- events, and add committee_task_activity to the realtime publication so
-- group-task chats get realtime events.
--
-- Originally 0066_chat_reaction_rls_and_realtime.sql on main. Version 0066 was
-- already claimed in this ledger by automation_opportunity_links, so it would
-- never have applied under its old name. Re-issued under the timestamp
-- convention (ADR 0007), and made re-runnable so the production run is safe.

-- 1. UPDATE policy for task_activity
DROP POLICY IF EXISTS "Authenticated users can update task activity" ON public.task_activity;
CREATE POLICY "Authenticated users can update task activity"
  ON public.task_activity FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 2. UPDATE policy for committee_task_activity
DROP POLICY IF EXISTS "Authenticated users can update committee task activity" ON public.committee_task_activity;
CREATE POLICY "Authenticated users can update committee task activity"
  ON public.committee_task_activity FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 3. Add committee_task_activity to realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'committee_task_activity'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.committee_task_activity;
  END IF;
END $$;
