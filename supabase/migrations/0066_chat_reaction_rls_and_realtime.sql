-- Fix: Add UPDATE RLS policies so Supabase Realtime can broadcast
-- reaction UPDATE events, and add committee_task_activity to the
-- realtime publication so group-task chats get realtime events.

-- 1. UPDATE policy for task_activity
CREATE POLICY "Authenticated users can update task activity"
  ON public.task_activity FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 2. UPDATE policy for committee_task_activity
CREATE POLICY "Authenticated users can update committee task activity"
  ON public.committee_task_activity FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 3. Add committee_task_activity to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.committee_task_activity;
