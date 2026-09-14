-- ==============================================================================
-- 0071_offset_leave_approved_hours.sql
--
-- Overtime approval lets HR record an approved_hours figure that can differ
-- from what was requested (0070); offset leave approval had no equivalent,
-- always crediting/debiting the requested hours verbatim. approved_hours
-- holds what HR actually approves, set on decision; NULL until then.
-- ==============================================================================

alter table public.offset_leaves add column if not exists approved_hours numeric;
