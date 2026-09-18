-- ==============================================================================
-- 0069_offsets_and_leaves_times.sql
--
-- Epic: Offsets and Leaves Specific Time
-- Add `start_time` and `end_time` columns to overtime, offset, and SIL request tables.
-- These columns capture the exact time window for the request.
-- ==============================================================================

alter table public.overtime_requests add column if not exists start_time time;
alter table public.overtime_requests add column if not exists end_time time;

alter table public.offset_leaves add column if not exists start_time time;
alter table public.offset_leaves add column if not exists end_time time;

alter table public.sil_leaves add column if not exists start_time time;
alter table public.sil_leaves add column if not exists end_time time;
