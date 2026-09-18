-- ==============================================================================
-- 20260828090000_flow_stage_color.sql
--
-- Flow Stage color
--
-- flow_stages had no per-Stage color at all (unlike crm_pipeline_stages.theme,
-- migration 0033) — every Stage rendered by its role instead (Entry/Won/
-- Terminal/Plain, see FlowCanvasNode's roleOf()). This adds an optional
-- override: null keeps the role-based default, a value picks a Stage's own
-- color regardless of role.
--
-- Constrained to the same named palette StatusBadge and crm_pipeline_stages
-- already use (constants/statusTheme.js) rather than free-form hex, so a Flow
-- Stage's color always renders through the same theme classes the rest of the
-- app does.
-- ==============================================================================

alter table public.flow_stages add column color text;

alter table public.flow_stages
  add constraint flow_stages_color_check
  check (color is null or color in ('mauve', 'amber', 'blue', 'red', 'violet', 'orange', 'green'));
