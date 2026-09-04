-- ==============================================================================
-- 0070_overtime_approved_hours.sql
--
-- Ticket #60: the overtime approval path currently credits the requested
-- hours verbatim, with no way for HR to record what was actually rendered.
-- `approved_hours` holds that figure, set when HR decides; NULL until then.
-- ==============================================================================

alter table public.overtime_requests add column if not exists approved_hours numeric;
