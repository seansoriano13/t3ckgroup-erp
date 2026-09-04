-- ==============================================================================
-- 0073_flow_canvas_realtime.sql
--
-- Enables Postgres Realtime for Flow Canvas tables so clients can sync
-- multiplayer edits instantly.
-- ==============================================================================

alter publication supabase_realtime add table public.sales_flows;
alter publication supabase_realtime add table public.flow_stages;
alter publication supabase_realtime add table public.flow_edges;
alter publication supabase_realtime add table public.stage_conditions;
alter publication supabase_realtime add table public.flow_stage_actions;
