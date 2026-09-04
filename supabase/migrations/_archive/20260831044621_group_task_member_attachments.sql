-- Originally 0041_group_task_member_attachments.sql on main. Version 0041 was
-- already claimed in this ledger by stage_requirements, so it would never have
-- applied under its old name. Re-issued under the timestamp convention (ADR 0007).

ALTER TABLE public.committee_task_members ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
