-- ==============================================================================
-- 0070_flow_stage_bracket_label.sql
--
-- Adds a bracket_label column to flow_stages. Stages sharing the same
-- (case-sensitive) label are grouped and drawn under one bracket on the
-- Flow Canvas — see FlowCanvas.jsx's `bracketed` map and
-- StageSettingsPanel.jsx's bracket editor. Null/blank means "no bracket".
-- Freeform text, no length cap: the label is operator-entered and rendered
-- as-is, with no fixed-width UI slot that a cap would be protecting.
-- ==============================================================================

alter table public.flow_stages add column bracket_label text;
