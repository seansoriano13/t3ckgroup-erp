-- ==============================================================================
-- 0048_flow_stages_and_edges.sql
--
-- The Sales Flow graph (issue #36 — Flow Canvas; ADR 0006). Stages private to
-- their flow, and the edges between them.
--
-- STAGES ARE PRIVATE, NEVER SHARED
-- `flow_stages.flow_id` is not null and there is no cross-flow reference. Two
-- flows may each contain a Stage named "Proposal Submitted"; they are unrelated
-- rows. A shared Stage library was rejected (ADR 0006) because editing a Stage
-- in one flow would silently change another, and every "does this apply here"
-- exception becomes a conditional on a shared object. The cost is real and
-- stated rather than discovered: a report grouping SORs by Stage across Sale
-- Types needs an explicit mapping. A reporting problem is cheaper than a
-- coupling problem.
--
-- This is also why these are NOT rows in `crm_pipeline_stages`. That table is
-- the single global pipeline, keyed by a text code, carrying is_anchor and
-- is_itb_gate — a total order with commission meaning attached. Flow Stages are
-- per-flow and unordered. Putting them in the same table would mean every
-- existing `status`-based query silently gained rows from flows it knows
-- nothing about.
--
-- sort_order CARRIES EXACTLY ONE RULE
-- It fixes where a Stage sits on the canvas and in a list, and the Stage that
-- sorts first is the flow's entry — where a newly registered SOR lands, and
-- where a Sale Type change lands one. Nothing else reads it: which moves are
-- permitted is the edge table's answer, and Realized stopped being positional
-- in ADR 0006. This is the load-bearing difference from
-- `crm_pipeline_stages.sort_order`, which every gate and the commission pool
-- used to compare against.
--
-- The entry is derived rather than designated (unlike the Won Stage) because
-- it needs no ceremony: the Operations Manager drags a Stage to the top and it
-- becomes where deals start, which is what she already means by doing that.
-- Deriving it instead from "the Stage with no incoming edges" would break on
-- the first loop back to the start, and loops are the reason this is a graph.
--
-- EDGES
-- One row per permitted move, directed. Loops back and skips ahead are ordinary
-- rows — that is the whole reason the flow is a graph. A self-edge is refused
-- (a move to the Stage you are already on is not a move) and a duplicate edge
-- is refused, so "is this move allowed" is a single existence check with no
-- de-duplication to get wrong.
--
-- Both endpoints carry `flow_id` alongside the stage ids, and a composite FK
-- forces each endpoint to belong to this edge's own flow. Without it an edge
-- could join two flows' Stages and silently make one flow's move legal by way
-- of another's, which is exactly the coupling private Stages exist to prevent.
--
-- WON STAGE
-- The FK deferred from 0047 lands here, now that flow_stages exists. `on delete
-- restrict`: deleting the Stage a flow calls Won is a decision, not a cascade —
-- the Operations Manager must move the designation first.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Two new tables and one FK onto a column added empty in 0047.
--   * No existing row is modified and no column is dropped.
--   * Idempotent.
-- ==============================================================================

create table if not exists public.flow_stages (
  id          uuid primary key default gen_random_uuid(),
  flow_id     uuid not null references public.sales_flows (id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  is_terminal boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint flow_stages_name_not_blank check (btrim(name) <> ''),
  -- The target of the composite FK from flow_edges below: it is what lets an
  -- edge require that a Stage belongs to the edge's own flow.
  constraint flow_stages_flow_scoped_key unique (flow_id, id)
);

create index if not exists flow_stages_flow_idx
  on public.flow_stages (flow_id, sort_order);

-- Two Stages in one flow may not share a name: the Operations Manager reads the
-- flow by Stage name, and two "Awaiting Approval"s make the drawing ambiguous
-- to the person it exists for. Across flows the same name is expected.
create unique index if not exists flow_stages_name_per_flow_key
  on public.flow_stages (flow_id, lower(btrim(name)));

create table if not exists public.flow_edges (
  id            uuid primary key default gen_random_uuid(),
  flow_id       uuid not null references public.sales_flows (id) on delete cascade,
  from_stage_id uuid not null,
  to_stage_id   uuid not null,
  created_at    timestamptz not null default now(),

  constraint flow_edges_no_self_loop check (from_stage_id <> to_stage_id),
  constraint flow_edges_unique unique (flow_id, from_stage_id, to_stage_id),

  constraint flow_edges_from_in_flow
    foreign key (flow_id, from_stage_id)
    references public.flow_stages (flow_id, id) on delete cascade,
  constraint flow_edges_to_in_flow
    foreign key (flow_id, to_stage_id)
    references public.flow_stages (flow_id, id) on delete cascade
);

create index if not exists flow_edges_from_idx
  on public.flow_edges (flow_id, from_stage_id);

alter table public.sales_flows
  drop constraint if exists sales_flows_won_stage_fkey;
alter table public.sales_flows
  add constraint sales_flows_won_stage_fkey
  foreign key (won_stage_id) references public.flow_stages (id) on delete restrict;

-- ── RLS — configuration: everyone reads, Super Admin writes ─────────────────

alter table public.flow_stages enable row level security;

drop policy if exists flow_stages_read on public.flow_stages;
create policy flow_stages_read on public.flow_stages
  for select to authenticated using (true);

drop policy if exists flow_stages_write on public.flow_stages;
create policy flow_stages_write on public.flow_stages
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  );

alter table public.flow_edges enable row level security;

drop policy if exists flow_edges_read on public.flow_edges;
create policy flow_edges_read on public.flow_edges
  for select to authenticated using (true);

drop policy if exists flow_edges_write on public.flow_edges;
create policy flow_edges_write on public.flow_edges
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  );
