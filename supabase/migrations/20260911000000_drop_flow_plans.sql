-- Issue #186 — the Flow Canvas loses its Sandbox mode. The single shared
-- Sandbox document lived in `flow_plans` (its `yjs_state` column), and nothing
-- in src/ reads or writes it any more: SandboxFlowDataProvider, useFlowPlanDoc,
-- flowPlanDoc, flowPlanService and their tests were all deleted.
--
-- `flow_plans` is defined in the 20260904000000 baseline, so it is dropped on
-- every database the Sandbox reached. `if exists` keeps this safe to re-run and
-- a no-op anywhere the table is already gone. `cascade` clears its RLS policies
-- and the `created_by` foreign key; nothing else references it.
--
-- Append-only forward migration, per AGENTS.md "Database migrations".

drop table if exists public.flow_plans cascade;
