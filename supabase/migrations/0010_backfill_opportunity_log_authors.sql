-- addSystemNote() always inserted author_id = null for opportunity log entries,
-- even though every call site already passed the actor's id in metadata.employeeId.
-- Backfill existing rows from that metadata so past "System" entries also show
-- who actually registered/moved the opportunity, not just new ones going forward.
UPDATE public.sales_opportunity_logs
SET author_id = (metadata->>'employeeId')::uuid
WHERE type = 'SYSTEM'
  AND author_id IS NULL
  AND metadata->>'employeeId' IS NOT NULL;
