-- ==============================================================================
-- 0050_flow_stage_positions.sql
--
-- Flow Canvas Node Positions
-- Allows the React Flow canvas to persist the visual layout of stages.
--
-- Adds pos_x and pos_y to flow_stages, which are updated when a stage is dragged
-- on the canvas. These do not affect flow execution logic, only visual rendering.
-- ==============================================================================

alter table public.flow_stages add column pos_x integer not null default 0;
alter table public.flow_stages add column pos_y integer not null default 0;
