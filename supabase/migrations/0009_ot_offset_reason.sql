-- Add a reason column to overtime_requests and offset_leaves, mirroring sil_leaves.
-- Kept nullable at the DB level (existing rows have no reason); the app enforces it as required for new applications.
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS reason text;
