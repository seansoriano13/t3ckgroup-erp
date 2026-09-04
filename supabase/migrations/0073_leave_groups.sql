-- ==============================================================================
-- 0073_leave_groups.sql
--
-- Ticket #63: leave applications over a date range.
--
-- A multi-day application writes one row per day rather than one row carrying
-- an end date, so the calendar's one-row-is-one-day assumption and the
-- month-boundary date queries keep working unchanged. `leave_group_id` links
-- the day-rows that belong to the same submission. A volatile default means
-- every existing row (and every future single-day application) gets its own
-- distinct group id — a single-day application is a group of one, with no
-- special-casing anywhere that reads this column.
-- ==============================================================================

ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS leave_group_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS leave_group_id UUID NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS offset_leaves_leave_group_id_idx ON public.offset_leaves (leave_group_id);
CREATE INDEX IF NOT EXISTS sil_leaves_leave_group_id_idx ON public.sil_leaves (leave_group_id);
