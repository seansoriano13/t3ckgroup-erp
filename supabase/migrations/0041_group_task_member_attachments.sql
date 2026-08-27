ALTER TABLE public.committee_task_members ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
