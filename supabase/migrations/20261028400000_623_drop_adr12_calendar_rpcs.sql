-- #623 (spec #609): the per-table calendar queries from ADR 0012 have no caller
-- left. The Calendar reads calendar_entries() (ADR 0037) instead.
drop function if exists public.get_calendar_offset_leaves(date, date);
drop function if exists public.get_calendar_sil_leaves(date, date);
