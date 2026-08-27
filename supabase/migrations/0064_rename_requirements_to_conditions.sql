-- ==============================================================================
-- 0064_rename_requirements_to_conditions.sql
--
-- Aligns database schema with CONTEXT.md domain vocabulary, which mandates
-- "Condition" over "Requirement".
-- ==============================================================================

ALTER TABLE public.stage_requirements RENAME TO stage_conditions;
ALTER TABLE public.sor_requirement_status RENAME TO sor_condition_status;

ALTER TABLE public.sor_condition_status RENAME COLUMN requirement_id TO condition_id;

ALTER INDEX IF EXISTS public.stage_requirements_stage_idx RENAME TO stage_conditions_stage_idx;
ALTER TABLE public.stage_conditions RENAME CONSTRAINT stage_requirements_kind_chk TO stage_conditions_kind_chk;

ALTER INDEX IF EXISTS public.sor_requirement_status_opp_idx RENAME TO sor_condition_status_opp_idx;
ALTER TABLE public.sor_condition_status RENAME CONSTRAINT sor_requirement_status_unique TO sor_condition_status_unique;

ALTER POLICY stage_requirements_read ON public.stage_conditions RENAME TO stage_conditions_read;
ALTER POLICY stage_requirements_write ON public.stage_conditions RENAME TO stage_conditions_write;
