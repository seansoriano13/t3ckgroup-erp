-- ==============================================================================
-- 0082_printed_tracking.sql
--
-- HR Document Center (issue #81): a printed batch stamps every record it
-- included so the picker can show "already printed" instead of HR relying on
-- memory. Non-blocking — informational only, never prevents reprinting.
-- ==============================================================================

alter table public.sil_leaves add column if not exists printed_at timestamptz;
alter table public.sil_leaves add column if not exists printed_by uuid references public.employees(id);

alter table public.offset_leaves add column if not exists printed_at timestamptz;
alter table public.offset_leaves add column if not exists printed_by uuid references public.employees(id);

alter table public.overtime_requests add column if not exists printed_at timestamptz;
alter table public.overtime_requests add column if not exists printed_by uuid references public.employees(id);
