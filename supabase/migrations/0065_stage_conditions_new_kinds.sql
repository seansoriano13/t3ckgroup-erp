-- ==============================================================================
-- 0065_stage_conditions_new_kinds.sql
--
-- Adding inclusions and purchasing to stage conditions.
-- ==============================================================================

alter table public.stage_conditions drop constraint if exists stage_conditions_kind_chk;

alter table public.stage_conditions add constraint stage_conditions_kind_chk check (kind in (
  'attachment', 'field', 'tickbox', 'assignment', 'deadline', 'project_evaluation', 'inclusions', 'purchasing'
));
