-- ==============================================================================
-- 20260904100000_consolidate_archived_migrations.sql
--
-- Consolidating migration: replays archived migrations 0047-0082 plus the
-- three August 2026 timestamped migrations that were not yet applied to the
-- staging or production databases.
--
-- All statements use IF NOT EXISTS / OR REPLACE guards so this is idempotent
-- and safe to run against a database that already has some of this schema.
-- ==============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0047_sale_types_and_sales_flows.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0047_sale_types_and_sales_flows.sql
--
-- Sale Types and the Sales Flows they own (issue #36 â€” Flow Canvas; ADR 0006).
-- The container ADR 0004 established survives â€” a deal carries a type, the type
-- owns a flow â€” but the axis is renamed and its values stop being fixed in code.
--
-- NOTHING IS SEEDED, AND THAT IS THE POINT
-- Bidding/Outright were the values ADR 0004 fixed, and every later meeting
-- contradicted them. The Operations Manager creates Sale Types from an empty
-- list so the system cannot steer her toward categories that do not match how
-- the business actually sells. A seed here would be the system proposing
-- values, which is the failure this table exists to end.
--
-- WHY TWO TABLES FOR A ONE-TO-ONE RELATIONSHIP
-- They are one-to-one and they are not the same thing. `sale_types` is the
-- axis value an SOR carries â€” the thing a Deal Owner picks at registration and
-- the thing a report groups by. `sales_flows` is the process object that gets
-- drafted, locked, unlocked, snapshotted and promoted, and it carries the lock
-- state and the Won Stage. Folding them together would put a lock timestamp on
-- the value stored against every deal.
--
-- WON STAGE AS A COLUMN, NOT A FLAG
-- `won_stage_id` lives here rather than as an `is_won` boolean on the Stage,
-- so "exactly one Won Stage per flow" is structural rather than a rule
-- somebody has to remember to enforce. Two Won Stages cannot be represented.
-- It is null while drafting and required to lock â€” that check belongs at the
-- lock, not in a NOT NULL that would make an empty draft unrepresentable.
-- The FK is added in 0048, once flow_stages exists.
--
-- THE LOCK STATE
-- `draft` -> `locked`. Locked is read-only, enforced in the service layer
-- (the same place every other cross-row rule in this schema lives) rather than
-- by a trigger, because unlocking is a legitimate action with an audit trail
-- and a trigger cannot tell an unlock from a tamper.
--
-- ACCESS
-- Super-Admin only, per issue #36: the canvas is scaffolding scheduled to be
-- hidden, and building a role for it is the scope creep the project exists to
-- prevent. Read is left open to authenticated users because an SOR will carry
-- a sale_type_id and every register row needs to resolve its name.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Two new tables â€” nothing existing selects them.
--   * No existing row is modified and no column is dropped.
--   * Idempotent.
-- ==============================================================================

create table if not exists public.sale_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references public.employees (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,

  constraint sale_types_name_not_blank check (btrim(name) <> '')
);

-- Names are unique among the live ones only. An archived Sale Type keeps its
-- name (the deals that carry it still read it), and must not stop the
-- Operations Manager reusing that name for a flow she is redrawing.
create unique index if not exists sale_types_live_name_key
  on public.sale_types (lower(btrim(name)))
  where archived_at is null;

create table if not exists public.sales_flows (
  id            uuid primary key default gen_random_uuid(),
  sale_type_id  uuid not null unique references public.sale_types (id) on delete cascade,
  state         text not null default 'draft',
  won_stage_id  uuid,
  locked_at     timestamptz,
  locked_by     uuid references public.employees (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint sales_flows_state_chk check (state in ('draft', 'locked'))
);

-- â”€â”€ RLS â€” configuration: everyone reads, Super Admin writes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- The same split 0033 and 0041 already draw. Read is open because an SOR
-- carries a sale_type_id and every register row resolves its name.

alter table public.sale_types enable row level security;

drop policy if exists sale_types_read on public.sale_types;
create policy sale_types_read on public.sale_types
  for select to authenticated using (true);

drop policy if exists sale_types_write on public.sale_types;
create policy sale_types_write on public.sale_types
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

alter table public.sales_flows enable row level security;

drop policy if exists sales_flows_read on public.sales_flows;
create policy sales_flows_read on public.sales_flows
  for select to authenticated using (true);

drop policy if exists sales_flows_write on public.sales_flows;
create policy sales_flows_write on public.sales_flows
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


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0048_flow_stages_and_edges.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0048_flow_stages_and_edges.sql
--
-- The Sales Flow graph (issue #36 â€” Flow Canvas; ADR 0006). Stages private to
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
-- is_itb_gate â€” a total order with commission meaning attached. Flow Stages are
-- per-flow and unordered. Putting them in the same table would mean every
-- existing `status`-based query silently gained rows from flows it knows
-- nothing about.
--
-- sort_order CARRIES EXACTLY ONE RULE
-- It fixes where a Stage sits on the canvas and in a list, and the Stage that
-- sorts first is the flow's entry â€” where a newly registered SOR lands, and
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
-- rows â€” that is the whole reason the flow is a graph. A self-edge is refused
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
-- restrict`: deleting the Stage a flow calls Won is a decision, not a cascade â€”
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

-- â”€â”€ RLS â€” configuration: everyone reads, Super Admin writes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0049_opportunity_sale_type.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0049_opportunity_sale_type.sql
--
-- An SOR carries a Sale Type, and sits on a Stage of that Sale Type's flow
-- (issue #36, ADR 0006).
--
-- TWO STAGE COLUMNS, ON PURPOSE, FOR NOW
-- `status` names a row in `crm_pipeline_stages` â€” the single global ordered
-- pipeline every existing deal, board, gate and report is built on.
-- `flow_stage_id` names a row in `flow_stages` â€” a Stage private to one Sales
-- Flow. They are different spaces and neither can be expressed as the other,
-- so an SOR is one of two things:
--
--   * sale_type_id IS NULL â€” a legacy deal. It moves through the global
--     pipeline and is gated exactly as it was before this migration existed.
--   * sale_type_id IS NOT NULL â€” a flow-built deal. It sits on flow_stage_id
--     and its moves are the edges the Operations Manager drew.
--
-- This is the expand half of an expandâ€“contract. Migrating existing SORs onto
-- the locked flows is explicitly not this ticket (issue #36), and cannot be
-- decided before she has drawn the flows. Until then both kinds coexist, and
-- the CHECK below is what stops a third, meaningless kind appearing: a deal
-- with a Sale Type but no Stage in its flow, or a Stage but no Sale Type.
--
-- `status` is deliberately left NOT NULL and unchanged. A flow-built deal
-- still carries whatever code it was registered with, because dropping it
-- would break every existing register query on the day this ships rather than
-- on the day the flows are ready.
--
-- WHY on delete restrict ON THE SALE TYPE
-- A Sale Type with live deals is retired by archiving it, never deleted. A
-- cascade here would take the deals with it; a set-null would leave deals in a
-- flow they no longer belong to. Refusing is the only answer that keeps a
-- deal's history explaining itself.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Two new nullable columns; every existing row becomes a legacy deal,
--     which is what every existing row is.
--   * The CHECK is satisfied by every existing row (both columns null).
--   * No running frontend names either column.
--   * Idempotent.
-- ==============================================================================

-- One `add column` per statement, matching every prior migration here: the
-- test harness's schema parser reads a column definition as everything up to
-- the semicolon, so a comma-separated pair silently becomes one mangled
-- column and the second one never exists as far as the tests are concerned.
alter table public.sales_opportunities
  add column if not exists sale_type_id uuid references public.sale_types (id) on delete restrict;

alter table public.sales_opportunities
  add column if not exists flow_stage_id uuid references public.flow_stages (id) on delete restrict;

alter table public.sales_opportunities
  drop constraint if exists sales_opportunities_flow_pairing_chk;
alter table public.sales_opportunities
  add constraint sales_opportunities_flow_pairing_chk
  check (
    (sale_type_id is null and flow_stage_id is null)
    or (sale_type_id is not null and flow_stage_id is not null)
  );

create index if not exists sales_opportunities_flow_stage_idx
  on public.sales_opportunities (flow_stage_id)
  where flow_stage_id is not null;

comment on column public.sales_opportunities.sale_type_id is
  'Issue #36: the Sales Flow this deal runs. Null means a legacy deal on the global crm_pipeline_stages pipeline.';
comment on column public.sales_opportunities.flow_stage_id is
  'Issue #36: the Stage of its own flow this deal sits on. Paired with sale_type_id â€” both set, or neither.';


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0050_flow_stage_positions.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0050_flow_stage_positions.sql
--
-- Flow Canvas Node Positions
-- Allows the React Flow canvas to persist the visual layout of stages.
--
-- Adds pos_x and pos_y to flow_stages, which are updated when a stage is dragged
-- on the canvas. These do not affect flow execution logic, only visual rendering.
-- ==============================================================================

alter table public.flow_stages add column if not exists pos_x integer not null default 0;
alter table public.flow_stages add column if not exists pos_y integer not null default 0;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0051_flow_stage_requirements.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0051_flow_stage_requirements.sql
--
-- Merging the Stage Gate Engine (ADR 0006) into Flow Stages.
-- 
-- The original stage_requirements (0041) was keyed to crm_pipeline_stages(code)
-- because Sales Flows didn't exist yet. With ADR 0006, the old pipeline is
-- deprecated and flows are per-sale-type graphs of `flow_stages`.
--
-- This migration drops the old tables and recreates them, pointing to 
-- `flow_stages(id)`. Because the pipeline shapes are fundamentally incompatible 
-- (global line vs per-type graph), old stage gate configs are intentionally dropped.
--
-- SAFE TO RUN AT ANY TIME: The feature was in scaffolding and not actively deployed.
-- ==============================================================================

-- Guarded on stage_conditions not existing yet: 0064 below renames
-- stage_requirements -> stage_conditions, and on a remote where that rename
-- already really happened, recreating the old-named table here would just
-- collide with it at the rename step. Skip the whole old-named build in
-- that case and let the rest of this file operate on stage_conditions.
DO $consolidate_stage_requirements$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'stage_conditions') THEN
    RETURN;
  END IF;

  EXECUTE 'drop table if exists public.sor_requirement_status cascade';
  EXECUTE 'drop table if exists public.stage_requirements cascade';

  EXECUTE $crt$
    create table public.stage_requirements (
      id           uuid primary key default gen_random_uuid(),
      stage_id     uuid not null references public.flow_stages (id) on delete cascade,
      kind         text not null,
      label        text not null,
      is_required  boolean not null default true,
      sort_order   integer not null default 0,
      config       jsonb not null default '{}'::jsonb,
      archived_at  timestamptz,
      created_at   timestamptz not null default now(),
      updated_at   timestamptz not null default now(),

      constraint stage_requirements_kind_chk check (kind in (
        'attachment', 'field', 'tickbox', 'assignment', 'deadline'
      ))
    )
  $crt$;

  EXECUTE $crt$
    create index stage_requirements_stage_idx
      on public.stage_requirements (stage_id, sort_order)
  $crt$;

  EXECUTE $crt$
    create table public.sor_requirement_status (
      id             uuid primary key default gen_random_uuid(),
      opportunity_id uuid not null references public.sales_opportunities (id) on delete cascade,
      requirement_id uuid not null references public.stage_requirements (id) on delete cascade,
      satisfied_by   uuid references public.employees (id),
      satisfied_at   timestamptz not null default now(),

      constraint sor_requirement_status_unique unique (opportunity_id, requirement_id)
    )
  $crt$;

  EXECUTE $crt$
    create index sor_requirement_status_opp_idx
      on public.sor_requirement_status (opportunity_id)
  $crt$;

  -- RLS - stage_requirements: configuration, Super-Admin write only
  EXECUTE 'alter table public.stage_requirements enable row level security';

  EXECUTE $crt$
    create policy stage_requirements_read on public.stage_requirements
      for select to authenticated using (true)
  $crt$;

  EXECUTE $crt$
    create policy stage_requirements_write on public.stage_requirements
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
      )
  $crt$;
END
$consolidate_stage_requirements$;

-- sor_requirement_status deliberately has no RLS block, matching sales_opportunity_logs.
-- Authorization is enforced at the service layer where the write actually happens.


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0052_seed_legacy_pipeline_to_flow.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0052_seed_legacy_pipeline_to_flow.sql
--
-- Seed the legacy `crm_pipeline_stages` into the new `sales_flows` / `flow_stages`
-- system so that the operations manager has a starting point in the Flow Canvas,
-- mirroring the pipeline that is currently active in production.
-- ==============================================================================

do $$
declare
  v_sale_type_id uuid;
  v_flow_id uuid;
  v_stage_id uuid;
  v_prev_stage_id uuid := null;
  v_stage record;
begin
  -- 1. Create a default Sale Type if one does not exist
  select id into v_sale_type_id
  from public.sale_types
  where lower(btrim(name)) = 'standard pipeline'
    and archived_at is null
  limit 1;

  if v_sale_type_id is null then
    insert into public.sale_types (name)
    values ('Standard Pipeline')
    returning id into v_sale_type_id;
  end if;

  -- 2. Create a Sales Flow for it (start as draft so it can be edited on canvas)
  select id into v_flow_id
  from public.sales_flows
  where sale_type_id = v_sale_type_id
  limit 1;

  if v_flow_id is null then
    insert into public.sales_flows (sale_type_id, state)
    values (v_sale_type_id, 'draft')
    returning id into v_flow_id;
  end if;

  -- Skip seeding if stages already exist to avoid duplicates
  if exists (select 1 from public.flow_stages where flow_id = v_flow_id) then
    return;
  end if;

  -- 3. Import stages and connect them linearly
  for v_stage in (
    select code, label, sort_order, is_won, is_lost, is_anchor 
    from public.crm_pipeline_stages 
    order by sort_order
  ) loop
    insert into public.flow_stages (flow_id, name, sort_order, is_terminal)
    values (v_flow_id, v_stage.label, v_stage.sort_order, v_stage.is_lost)
    returning id into v_stage_id;

    -- Draw an edge from the previous stage to this one
    if v_prev_stage_id is not null then
      insert into public.flow_edges (flow_id, from_stage_id, to_stage_id)
      values (v_flow_id, v_prev_stage_id, v_stage_id);
    end if;

    -- Mark Won Stage
    if v_stage.is_won then
      update public.sales_flows set won_stage_id = v_stage_id where id = v_flow_id;
    end if;
    
    v_prev_stage_id := v_stage_id;
  end loop;

end;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0053_flow_stage_actions.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0053_flow_stage_actions.sql
--
-- Flow Stage Actions (Automations).
-- Actions fire automatically when a deal enters a stage, unlike Requirements
-- which block a deal from leaving.
-- ==============================================================================

create table if not exists public.flow_stage_actions (
  id           uuid primary key default gen_random_uuid(),
  stage_id     uuid not null references public.flow_stages (id) on delete cascade,
  kind         text not null,
  config       jsonb not null default '{}'::jsonb,
  sort_order   integer not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint flow_stage_actions_kind_chk check (kind in (
    'create_group_task', 'create_individual_task'
  ))
);

create index if not exists flow_stage_actions_stage_idx
  on public.flow_stage_actions (stage_id, sort_order);

-- â”€â”€ RLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

alter table public.flow_stage_actions enable row level security;

drop policy if exists flow_stage_actions_read on public.flow_stage_actions;
create policy flow_stage_actions_read on public.flow_stage_actions
  for select to authenticated using (true);

drop policy if exists flow_stage_actions_write on public.flow_stage_actions;
create policy flow_stage_actions_write on public.flow_stage_actions
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


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0054_purchasing_flow_flag.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0054_purchasing_flow_flag.sql
--
-- Purchasing access (issue #39). Purchasing becomes a Module of its own, with
-- an open Procurement Request queue behind it, so this is the flag that decides
-- who sees it â€” the third member of the set `has_sales_flow` and
-- `has_task_flow` already form.
--
-- WHY A FLAG AND NOT THE DEPARTMENT COLUMN
-- `employees.department` and `employees.sub_department` are free text. The org
-- really does file purchasing as a sub-department under OPERATIONS (see the
-- procurementService fixtures, which mirror that deliberately), so gating on
-- the string is tempting and would even work on the day it is written. It fails
-- the first time somebody types "Purchasing " or "PURCHASING/ADMIN": the
-- purchaser's queue disappears with no error anywhere explaining why, because
-- nothing in the system claims that column means anything. A boolean cannot be
-- misspelled, and the Super Admin who sets it can see what they set.
--
-- The existing access booleans are the prior art and the precedent this follows
-- exactly: 0000_baseline_schema.sql declares `has_sales_flow boolean default
-- false` and `has_task_flow boolean default true` on this same table.
--
-- WHY IT DEFAULTS FALSE
-- `has_task_flow` defaults true because everyone logs tasks. Purchasing is a
-- handful of people, so the safe default is the one that grants nothing: an
-- existing employee gains no new visibility from this migration running, and a
-- Super Admin turns it on for the people who do the work.
--
-- NOTE ON SCOPE: this grants sight of the Purchasing Module, nothing more. It
-- confers no write access anywhere. Who may resolve or reassign a Procurement
-- Request is still decided entirely by the RLS policies in
-- 0017_sor_procurement_requests.sql, which key on `assigned_to`,
-- `requested_by`, and the head/super-admin escalation â€” deliberately not on
-- this flag, so that turning the Module on for somebody cannot silently widen
-- what they may change.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * One new column with a NOT NULL DEFAULT false. Every existing row becomes
--     "no purchasing access", which is what every existing row already is.
--   * No existing row changes meaning, and no deployed frontend selects it.
--   * A frontend deployed before this migration keeps working: it never names
--     the column, and the default makes its inserts valid.
--   * Idempotent.
-- ==============================================================================

alter table public.employees
  add column if not exists has_purchasing_flow boolean not null default false;

comment on column public.employees.has_purchasing_flow is
  'Purchasing Module access (issue #39): shows the Purchasing nav and its open Procurement Request queue. Visibility only â€” write access to a procurement request is governed by the RLS policies in 0017.';


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0055_sor_inclusions.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0055_sor_inclusions.sql
--
-- Inclusions (issue #43): the client's specification, broken out one row per
-- item they actually asked for.
--
-- â”€â”€ Why this table has to exist at all â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Odoo bundles. An Ambulance Commuter or a Rescue Vehicle is ONE line on the
-- sale order, and the inclusions and accessories that make it up are written as
-- free text inside that line's description (confirmed on S06070). There is
-- therefore no way, in Odoo, to walk a tender's spec sheet item by item and
-- confirm each requirement is accounted for â€” which is exactly what an
-- apple-to-apple comparison against that tender demands. The team rebuilds that
-- breakdown in a spreadsheet on every deal. This is that breakdown.
--
-- â”€â”€ Why these are NOT sales_opportunity_items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Same reason 0017 gave for procurement requests, and it is worth restating
-- because the temptation is identical. opportunityService.replaceItems deletes
-- every item row and re-inserts with fresh UUIDs on each SOR save. Line items
-- therefore have no stable identity, and anything hanging off one â€” a Canvass,
-- a stamped cost, a completeness state somebody spent an afternoon deciding â€”
-- would be destroyed, silently, the next time anyone edited the SOR.
--
-- Inclusions carry their own identity precisely because Canvass (#46, #47) and
-- cost attach to them. That is also why this ticket does not need to touch
-- replaceItems at all: the two lists answer different questions. A line item is
-- what Odoo is selling. An Inclusion is what the client asked for.
--
-- â”€â”€ The two states, and why sourcing is not a boolean â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- completeness answers "is this spec fully answered" â€” the module's whole
-- purpose. It defaults to MISSING because a row entered from a spec sheet has
-- not been answered yet, and defaulting to COVERED would make a fresh
-- breakdown read as complete.
--
-- sourcing is deliberately three-valued. An earlier draft had `is_source_out`
-- as a boolean; that collapses the middle case, because a stockable item with
-- zero on hand still needs ordering and is explicitly NOT source-out. It is
-- nullable, and null means nobody has assessed it yet â€” which is a real state
-- and is not the same as claiming the item is on the shelf. Set by hand for
-- now; a live Odoo qty_available read is out of scope (#38).
--
-- â”€â”€ RLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Read is org-wide, matching the parent opportunity.
--
-- INSERT and DELETE are sor_can_edit_opportunity: what the client asked for is
-- a sales fact, and sales owns the list.
--
-- UPDATE additionally admits anyone holding purchasing access. This is not
-- generosity â€” it is the policy the next two tickets need and it belongs here
-- rather than in a follow-up migration that would have to rewrite it: #45 has a
-- purchaser's Procurement Request outcome writing completeness back onto the
-- Inclusion it came from, and #47 has the winning Canvass offer stamping the
-- cost. Both run as the purchaser. Without this clause both would fail at RLS
-- with a row count of zero rather than an error, which is the worst way for a
-- permission problem to present.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Creates a new table. No deployed frontend selects it, so nothing can be
--     broken by it existing early.
--   * No existing row, table or policy is modified.
--   * Idempotent â€” safe to re-run.
-- ==============================================================================

create table if not exists public.sor_inclusions (
  id                 uuid primary key default gen_random_uuid(),
  opportunity_id     uuid not null references public.sales_opportunities(id) on delete cascade,

  -- What the client asked for, in their words or the spec sheet's. Free text
  -- by construction: a tender line is a paragraph of requirements far more
  -- often than it is a catalog product name.
  description        text not null,
  quantity           numeric(12,2) not null default 1,
  unit               text,
  note               text,

  -- Is the client's specification answered? The primary question.
  completeness       text not null default 'MISSING' check (completeness in (
                       'COVERED',       -- accounted for as asked
                       'MISSING',       -- not yet answered
                       'SUBSTITUTED',   -- answered with something else; sales must re-price
                       'NOT_REQUIRED'   -- listed, but the client does not need it
                     )),

  -- How the item would be obtained. Null until somebody assesses it.
  sourcing           text check (sourcing in (
                       'STOCKABLE_AVAILABLE',       -- carried, on hand
                       'STOCKABLE_NEEDS_ORDERING',  -- carried, none on hand
                       'SOURCE_OUT'                 -- not carried; must be sourced
                     )),

  sort_order         integer not null default 0,

  created_by         uuid references public.employees(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists sor_inclusions_opp_idx
  on public.sor_inclusions (opportunity_id, sort_order);

create or replace function public.sor_inclusions_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sor_inclusions_touch on public.sor_inclusions;
create trigger trg_sor_inclusions_touch
  before update on public.sor_inclusions
  for each row execute function public.sor_inclusions_touch();

alter table public.sor_inclusions enable row level security;

drop policy if exists sor_inclusions_read on public.sor_inclusions;
create policy sor_inclusions_read on public.sor_inclusions
  for select to authenticated using (true);

drop policy if exists sor_inclusions_insert on public.sor_inclusions;
create policy sor_inclusions_insert on public.sor_inclusions
  for insert to authenticated
  with check (public.sor_can_edit_opportunity(opportunity_id));

-- See the RLS note above: the purchasing clause is what #45 and #47 write
-- through. WITH CHECK mirrors USING so a row cannot be moved onto a different
-- opportunity by an update.
drop policy if exists sor_inclusions_update on public.sor_inclusions;
create policy sor_inclusions_update on public.sor_inclusions
  for update to authenticated
  using (
    public.sor_can_edit_opportunity(opportunity_id)
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and e.has_purchasing_flow
    )
  )
  with check (
    public.sor_can_edit_opportunity(opportunity_id)
    or exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and e.has_purchasing_flow
    )
  );

drop policy if exists sor_inclusions_delete on public.sor_inclusions;
create policy sor_inclusions_delete on public.sor_inclusions
  for delete to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id));

comment on table public.sor_inclusions is
  'Issue #43. The client''s specification, one row per item asked for. Exists because Odoo bundles a complex product into a single order line, making the spec check impossible there. Deliberately not sales_opportunity_items: replaceItems destroys line identity on every save.';


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0056_procurement_request_inclusion_link.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0056_procurement_request_inclusion_link.sql
--
-- Ties a Procurement Request back to the Inclusion it was raised from
-- (issue #45).
--
-- WHY
-- When purchasing answers "cannot be sourced" or "sourced something else", that
-- answer is about an item on the client's specification. Today it stops at the
-- request row, and somebody has to go and set the Inclusion's completeness by
-- hand â€” which means the spec check, the one thing this module exists to make
-- reliable, is only as current as whoever remembered to update it twice.
--
-- With the link, resolving the request updates the breakdown. Nobody re-enters
-- the same fact in two places, and the two cannot drift.
--
-- ON DELETE SET NULL, deliberately â€” mirroring task_id in 0017 and for the same
-- reason. A request is the frozen record of what was asked for and must outlive
-- the row that prompted it. If sales deletes an Inclusion after purchasing has
-- already answered it, the answer stays; it simply stops pointing anywhere.
--
-- NULLABLE, and most rows will stay null. Requests are still raised straight
-- from the composer for products that were never on a spec sheet, which is the
-- original case 0017 was written for and is not changed here. Null means
-- "raised on its own", and the write-back skips those rows entirely.
--
-- NO UNIQUE CONSTRAINT. One Inclusion can legitimately be sourced more than
-- once â€” a first attempt comes back UNAVAILABLE, a second finds a substitute â€”
-- and forcing uniqueness would make the second, more useful answer the one that
-- errors. The write-back therefore applies whichever request was resolved last,
-- which is the answer somebody just gave.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * One new nullable column with no default. Every existing row keeps meaning
--     exactly what it meant: a request raised on its own.
--   * No existing row, policy or constraint is modified.
--   * A frontend deployed before this migration never names the column.
--   * Idempotent.
-- ==============================================================================

alter table public.sor_procurement_requests
  add column if not exists inclusion_id uuid
    references public.sor_inclusions(id) on delete set null;

comment on column public.sor_procurement_requests.inclusion_id is
  'Issue #45: the Inclusion this request was raised from, if any. Resolving the request writes its outcome back onto that Inclusion''s completeness. Null means the request was raised on its own, which is the 0017 case and stays unchanged.';

-- The write-back reads by inclusion, and the breakdown shows what has been
-- sent to purchasing. Partial: rows with no link are the majority and are never
-- looked up this way.
create index if not exists sor_procurement_requests_inclusion_idx
  on public.sor_procurement_requests (inclusion_id)
  where inclusion_id is not null;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0057_flow_snapshots.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0057_flow_snapshots.sql
--
-- Flow Snapshots (issue #36 â€” Flow Canvas; ADR 0006).
-- Each lock snapshots the entire flow (Sale Type, Stages, edges, Actions, 
-- Conditions, notes, Won Stage).
-- 
-- A flow snapshot represents a frozen point in time that the Operations Manager 
-- and Boss agreed upon. It contains the JSON configuration that can be emitted
-- as artefacts and promoted to other environments.
-- ==============================================================================

create table if not exists public.flow_snapshots (
  id            uuid primary key default gen_random_uuid(),
  flow_id       uuid not null references public.sales_flows (id) on delete cascade,
  version       integer not null,
  snapshot_data jsonb not null,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.employees (id),
  
  constraint flow_snapshots_version_unique unique (flow_id, version)
);

-- â”€â”€ RLS â€” configuration: everyone reads, Super Admin writes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

alter table public.flow_snapshots enable row level security;

drop policy if exists flow_snapshots_read on public.flow_snapshots;
create policy flow_snapshots_read on public.flow_snapshots
  for select to authenticated using (true);

drop policy if exists flow_snapshots_write on public.flow_snapshots;
create policy flow_snapshots_write on public.flow_snapshots
  for insert to authenticated
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and e.is_super_admin
    )
  );

-- We don't allow updates or deletes on snapshots by anyone (even super admins). 
-- They are an immutable audit log of locked configurations.


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0058_commission_retention_rate.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0058_commission_retention_rate.sql
--
-- Retention as a fourth dated Commission Rate type (issue #42), alongside VAT,
-- Withholding and Pool. Government projects lose 1% to retention on top of the
-- tax already deducted; a Super Admin records it the same way as any other
-- rate, dated and versioned.
--
-- Read only by Project Evaluation (issue #48). Nothing in the Commission Pool
-- asks for a Retention rate, so an unconfigured one leaves every existing
-- commission figure exactly as it was â€” see commission.js, where
-- resolveEffectiveRatesFromList still only requires VAT/WITHHOLDING/POOL, and
-- calculateCommissionableRevenue's retentionPercent defaults to 0.
--
-- No default row is seeded. A project that isn't government work never needs
-- one, and seeding a rate nobody asked for is a rate somebody has to remember
-- to keep current.
--
-- SAFE TO RUN AT ANY TIME, against a live frontend of any version: widens a
-- CHECK constraint only, touches no existing rows, and a frontend deployed
-- before this migration never writes 'RETENTION'.
-- ==============================================================================

alter table public.commission_rates
  drop constraint if exists commission_rates_rate_type_chk;

alter table public.commission_rates
  add constraint commission_rates_rate_type_chk
    check (rate_type in ('VAT', 'WITHHOLDING', 'POOL', 'RETENTION'));


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0059_sor_canvass.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0059_sor_canvass.sql
--
-- Canvass (issue #38 vocabulary; this ticket #46, Inclusion side in #47): the
-- three-or-more supplier comparison, recorded as structured Offers instead of
-- an ad-hoc sheet nobody can produce later as evidence.
--
-- â”€â”€ One Canvass, one subject â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- A Canvass belongs to exactly one of a Procurement Request or an Inclusion â€”
-- "shop this specific ask that already has a home" versus "price this line of
-- the client's spec directly." The CHECK below enforces exactly one of the two
-- foreign keys is set. This ticket ships the Procurement Request side, which
-- already exists; the Inclusion side (#47) needs nothing further here, the
-- column is just unused by this ticket's UI until then.
--
-- â”€â”€ Offers, not a flat price column â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Policy is price, delivery speed and quality â€” never price alone â€” so an
-- Offer carries brand, description, source link, brochure, remarks, unit
-- price, lead time and a quality note. lead_time is free text ("depends on the
-- product" per purchasing â€” a 3-day item and a 12-week item are not usefully
-- forced into one column shape).
--
-- â”€â”€ The three-offer minimum is not a CHECK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Research happens over days; a Canvass must be saveable half-finished. The
-- minimum is a warning enforced in the UI at sign-off (constants/
-- projectEvaluation.js), never a database constraint.
--
-- â”€â”€ At most one winner, enforced twice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- The partial unique index makes "two winners on one Canvass" impossible even
-- from a bad write path. projectEvaluationService additionally clears the old
-- winner before setting the new one (two sequential awaited writes), so the
-- index is never hit transiently â€” it's a backstop, not the primary mechanism,
-- which is the pure applyWinner() function tested at the unit tier.
--
-- â”€â”€ RLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Read is org-wide, matching every other SOR-scoped table.
--
-- Write is has_purchasing_flow (or head / super admin) â€” canvassing is
-- purchasing's job regardless of which subject a Canvass hangs off. This is
-- deliberately NOT sor_can_edit_opportunity: a purchaser is routinely not one
-- of the SOR's sales participants, exactly as 0017 and 0055 already reasoned
-- for procurement requests and Inclusion sourcing.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Creates two new tables. No deployed frontend selects them.
--   * No existing row, table or policy is modified.
--   * Idempotent â€” safe to re-run.
-- ==============================================================================

create table if not exists public.sor_canvasses (
  id                      uuid primary key default gen_random_uuid(),

  procurement_request_id  uuid references public.sor_procurement_requests(id) on delete cascade,
  inclusion_id            uuid references public.sor_inclusions(id) on delete cascade,

  -- The original working sheet, evidence that canvassing happened however the
  -- purchaser actually did it. Same descriptor shape as every other attachment
  -- column in this schema: [{ url, name, type, bytes }].
  attachments             jsonb not null default '[]'::jsonb,

  signed_off_by           uuid references public.employees(id),
  signed_off_at           timestamptz,

  created_by              uuid references public.employees(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint sor_canvasses_one_subject_chk check (
    (procurement_request_id is not null)::int + (inclusion_id is not null)::int = 1
  )
);

create index if not exists sor_canvasses_procurement_request_idx
  on public.sor_canvasses (procurement_request_id)
  where procurement_request_id is not null;

create index if not exists sor_canvasses_inclusion_idx
  on public.sor_canvasses (inclusion_id)
  where inclusion_id is not null;

create table if not exists public.sor_canvass_offers (
  id             uuid primary key default gen_random_uuid(),
  canvass_id     uuid not null references public.sor_canvasses(id) on delete cascade,

  brand          text,
  description    text,
  source_link    text,
  brochure       jsonb not null default '[]'::jsonb,
  remarks        text,
  unit_price     numeric(14,2),
  lead_time      text,
  quality_note   text,

  is_winner      boolean not null default false,
  sort_order     integer not null default 0,

  created_by     uuid references public.employees(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists sor_canvass_offers_canvass_idx
  on public.sor_canvass_offers (canvass_id, sort_order);

-- At most one winner per Canvass. See the note above the table for why the
-- service still clears-then-sets rather than leaning on this alone.
create unique index if not exists sor_canvass_offers_one_winner_per_canvass
  on public.sor_canvass_offers (canvass_id)
  where is_winner;

create or replace function public.sor_canvasses_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sor_canvasses_touch on public.sor_canvasses;
create trigger trg_sor_canvasses_touch
  before update on public.sor_canvasses
  for each row execute function public.sor_canvasses_touch();

create or replace function public.sor_canvass_offers_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sor_canvass_offers_touch on public.sor_canvass_offers;
create trigger trg_sor_canvass_offers_touch
  before update on public.sor_canvass_offers
  for each row execute function public.sor_canvass_offers_touch();

alter table public.sor_canvasses enable row level security;
alter table public.sor_canvass_offers enable row level security;

drop policy if exists sor_canvasses_read on public.sor_canvasses;
create policy sor_canvasses_read on public.sor_canvasses
  for select to authenticated using (true);

drop policy if exists sor_canvasses_write on public.sor_canvasses;
create policy sor_canvasses_write on public.sor_canvasses
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.has_purchasing_flow or e.is_head or e.is_super_admin)
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.has_purchasing_flow or e.is_head or e.is_super_admin)
    )
  );

drop policy if exists sor_canvass_offers_read on public.sor_canvass_offers;
create policy sor_canvass_offers_read on public.sor_canvass_offers
  for select to authenticated using (true);

drop policy if exists sor_canvass_offers_write on public.sor_canvass_offers;
create policy sor_canvass_offers_write on public.sor_canvass_offers
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.has_purchasing_flow or e.is_head or e.is_super_admin)
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id()
        and (e.has_purchasing_flow or e.is_head or e.is_super_admin)
    )
  );

comment on table public.sor_canvasses is
  'Issue #46/#47. The supplier comparison as evidence: belongs to exactly one Procurement Request or Inclusion, never both.';
comment on table public.sor_canvass_offers is
  'Issue #46/#47. One supplier offer within a Canvass. At most one per Canvass may carry is_winner â€” see sor_canvass_offers_one_winner_per_canvass.';


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0060_sor_inclusion_cost.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0060_sor_inclusion_cost.sql
--
-- An Inclusion's cost basis (issue #47) â€” a stamped snapshot, never read
-- live. A decision has to be reproducible: a background job that silently
-- moved the number underneath an already-made decision would destroy that,
-- so the cost is written once (by markWinner or an explicit refresh) and
-- read back exactly as stored until somebody deliberately asks for it again.
--
-- â”€â”€ Why three columns, not one â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- amount alone cannot answer "is this still trustworthy" â€” cost_established_at
-- is what the screen's staleness display reads (constants/projectEvaluation.js
-- costAgeDays), and cost_source is what tells a reader whether the figure came
-- from a canvassed winner, Odoo's catalog, or somebody typing a number in by
-- hand â€” the same three-tier priority order resolveCost() implements.
--
-- Nullable, all three, together: an Inclusion nobody has costed yet has none
-- of them set, which is a different statement from a cost of zero.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Three new nullable columns with no default. Every existing Inclusion
--     keeps meaning exactly what it meant: not yet costed.
--   * No existing row, table or policy is modified.
--   * Idempotent â€” safe to re-run.
-- ==============================================================================

alter table public.sor_inclusions
  add column if not exists cost_amount numeric(14,2);

alter table public.sor_inclusions
  add column if not exists cost_source text;

alter table public.sor_inclusions
  add column if not exists cost_established_at timestamptz;

alter table public.sor_inclusions
  drop constraint if exists sor_inclusions_cost_source_chk;

alter table public.sor_inclusions
  add constraint sor_inclusions_cost_source_chk check (
    cost_source is null or cost_source in ('CANVASS_OFFER', 'ODOO_CATALOG', 'MANUAL')
  );

comment on column public.sor_inclusions.cost_amount is
  'Issue #47: stamped cost basis, resolved in priority order (winning Canvass offer, Odoo catalog, manual entry) and never read live.';
comment on column public.sor_inclusions.cost_source is
  'Issue #47: which of the three tiers cost_amount came from â€” see constants/projectEvaluation.js resolveCost().';
comment on column public.sor_inclusions.cost_established_at is
  'Issue #47: when cost_amount was stamped. Drives the staleness display; only an explicit refresh (or a new Canvass winner) moves it.';


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0061_sor_project_evaluations.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0061_sor_project_evaluations.sql
--
-- Project Evaluation (issue #38 vocabulary; this ticket #48) â€” the go/no-go.
-- One record per SOR, holding the numbers a salesperson decides a project on:
-- a candidate sales price, an estimated operating expense figure, and whether
-- the client is a government body (which is what turns the VAT/Withholding/
-- Retention deduction sequence on).
--
-- â”€â”€ One per SOR, and it may exist before Odoo does â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- opportunity_id is UNIQUE: an SOR gets at most one Project Evaluation, not a
-- history of them â€” sign-off is what records a decision was made, not a new
-- row. NOT NULL and ON DELETE CASCADE because an evaluation with no SOR to
-- decide about is meaningless. No requirement that the SOR carry a Sales
-- Reference: the whole point (per the parent issue) is that the decision
-- often comes before the deal exists in Odoo at all.
--
-- â”€â”€ Base cost is NOT a column here â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- It rolls up live from the SOR's Inclusions and their stamped costs
-- (constants/projectEvaluation.js rollUpBaseCost, migration 0060's cost_amount
-- column) every time the evaluation is read, the same way Completeness already
-- does. Storing a second copy would drift from the Inclusions the moment any
-- one of them is re-costed.
--
-- â”€â”€ Candidate price, never a price Odoo sees â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- candidate_sales_price is what this record is for deciding with. It is never
-- written to Odoo â€” markup and final pricing stay there, per the parent
-- issue's explicit decision. Where it differs from the Odoo order's own price
-- (sales_opportunities.expected_value, once bound), both are shown with the
-- delta; nothing here reconciles them.
--
-- â”€â”€ Sign-off is recorded, not required â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- signed_off_by / signed_off_at exist so a decision has an owner. Nothing in
-- this migration enforces sign-off happening before anything else â€” ticket #50
-- gates a Stage on the *existence* of a Project Evaluation, explicitly not on
-- whether it has been signed off.
--
-- â”€â”€ RLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Read is org-wide, matching every other SOR-scoped table.
--
-- Write mirrors sor_can_edit_opportunity (0003) â€” the same sales participants,
-- heads and super admins who may edit the SOR itself. This is a sales decision
-- about a sales deal, unlike Inclusions/Canvass which purchasing also writes
-- to; there is deliberately no has_purchasing_flow clause here.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Creates a new table. No deployed frontend selects it.
--   * No existing row, table or policy is modified.
--   * Idempotent â€” safe to re-run.
-- ==============================================================================

create table if not exists public.sor_project_evaluations (
  id                     uuid primary key default gen_random_uuid(),
  opportunity_id         uuid not null unique references public.sales_opportunities(id) on delete cascade,

  candidate_sales_price  numeric(14,2),
  estimated_opex         numeric(14,2),
  is_government_client   boolean not null default false,

  signed_off_by          uuid references public.employees(id),
  signed_off_at          timestamptz,

  created_by             uuid references public.employees(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create or replace function public.sor_project_evaluations_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sor_project_evaluations_touch on public.sor_project_evaluations;
create trigger trg_sor_project_evaluations_touch
  before update on public.sor_project_evaluations
  for each row execute function public.sor_project_evaluations_touch();

alter table public.sor_project_evaluations enable row level security;

drop policy if exists sor_project_evaluations_read on public.sor_project_evaluations;
create policy sor_project_evaluations_read on public.sor_project_evaluations
  for select to authenticated using (true);

drop policy if exists sor_project_evaluations_write on public.sor_project_evaluations;
create policy sor_project_evaluations_write on public.sor_project_evaluations
  for all to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id))
  with check (public.sor_can_edit_opportunity(opportunity_id));

comment on table public.sor_project_evaluations is
  'Issue #48. The go/no-go: candidate price, estimated opex and the government-deduction toggle, one row per SOR. Base cost is not stored here â€” it rolls up live from sor_inclusions.cost_amount.';


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0062_sor_purchase_order_links.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0062_sor_purchase_order_links.sql
--
-- Actual cost (issue #48/#49) â€” local overrides to the live Odoo rollup of
-- purchase orders whose Source Document names the sale order.
--
-- â”€â”€ Why this table holds overrides, not the rollup itself â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- The rollup total is read live from Odoo every time (a new edge function,
-- odoo-po-rollup) â€” storing a second copy of what Odoo already knows would
-- drift from it the moment anyone re-prices a PO. This table exists only for
-- the two things Odoo's search cannot express: a PO whose Source Document was
-- never filled in (attached manually, by number) and a PO Odoo's search
-- wrongly matched (detached, so it stops counting).
--
-- â”€â”€ One row per (opportunity, PO number), meaning "this po_number is not
-- what a fresh Odoo search alone would say" â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- origin records where the override came from: 'ODOO_ORIGIN' means Odoo's own
-- search found it and this row exists only to detach it (is_detached is then
-- always true â€” a non-detached ODOO_ORIGIN row would carry no information a
-- fresh search doesn't already give). 'MANUAL' means a human typed the PO
-- number in because Odoo's search missed it; is_detached is false unless
-- someone later un-attaches it, at which point the row is simply deleted
-- (there is nothing left to override once neither the search nor a human
-- claims the number).
--
-- A PO nobody has ever touched has NO row here at all â€” it is whatever the
-- live search says, which is the point: a detach has to survive the next
-- refresh, and it does so by being the one thing recorded, not by every
-- ordinary match also needing a row.
--
-- â”€â”€ RLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Read is org-wide, matching every other SOR-scoped table. Write mirrors
-- sor_can_edit_opportunity (0003) â€” reconciling actual cost against the
-- estimate is the same sales-side decision the Project Evaluation itself is.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Creates a new table. No deployed frontend selects it.
--   * No existing row, table or policy is modified.
--   * Idempotent â€” safe to re-run.
-- ==============================================================================

create table if not exists public.sor_purchase_order_links (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.sales_opportunities(id) on delete cascade,

  po_number       text not null,
  origin          text not null check (origin in ('ODOO_ORIGIN', 'MANUAL')),
  is_detached     boolean not null default false,

  created_by      uuid references public.employees(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint sor_purchase_order_links_unique unique (opportunity_id, po_number)
);

create index if not exists sor_purchase_order_links_opp_idx
  on public.sor_purchase_order_links (opportunity_id);

create or replace function public.sor_purchase_order_links_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sor_purchase_order_links_touch on public.sor_purchase_order_links;
create trigger trg_sor_purchase_order_links_touch
  before update on public.sor_purchase_order_links
  for each row execute function public.sor_purchase_order_links_touch();

alter table public.sor_purchase_order_links enable row level security;

drop policy if exists sor_purchase_order_links_read on public.sor_purchase_order_links;
create policy sor_purchase_order_links_read on public.sor_purchase_order_links
  for select to authenticated using (true);

drop policy if exists sor_purchase_order_links_write on public.sor_purchase_order_links;
create policy sor_purchase_order_links_write on public.sor_purchase_order_links
  for all to authenticated
  using (public.sor_can_edit_opportunity(opportunity_id))
  with check (public.sor_can_edit_opportunity(opportunity_id));

comment on table public.sor_purchase_order_links is
  'Issue #49. Overrides to the live Odoo PO rollup: a manual attach for a PO Source Document missed, or a detach for one wrongly matched. A po_number with no row is neither â€” it is exactly what the live search says.';


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0063_stage_requirement_project_evaluation_kind.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0063_stage_requirement_project_evaluation_kind.sql
--
-- A sixth Stage requirement kind (issue #50): 'project_evaluation'. A Super
-- Admin can gate a Stage on a deal simply having a Project Evaluation on
-- record (issue #48) â€” existence alone satisfies it, sign-off is recorded but
-- never required, matching how the kind's evaluation branch in
-- constants/stageGate.js reads sor_project_evaluations (issue #61).
--
-- Widens the CHECK constraint 0051 defined when Stage Requirements moved onto
-- Flow Stages. No config columns are added: config is already the free-form
-- jsonb every other kind already uses, and this kind's only optional field â€”
-- a reference link, shown to whoever is blocked â€” fits inside it exactly the
-- way a `deadline` requirement's `days` already does.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Widens a CHECK constraint only, touches no existing rows.
--   * A frontend deployed before this migration never writes
--     'project_evaluation', so nothing existing is affected.
-- ==============================================================================

DO $$ 
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'stage_requirements') THEN
    alter table public.stage_requirements drop constraint if exists stage_requirements_kind_chk;
    alter table public.stage_requirements add constraint stage_requirements_kind_chk check (kind in ('attachment', 'field', 'tickbox', 'assignment', 'deadline', 'project_evaluation'));
  ELSIF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'stage_conditions') THEN
    alter table public.stage_conditions drop constraint if exists stage_requirements_kind_chk;
    alter table public.stage_conditions drop constraint if exists stage_conditions_kind_chk;
    alter table public.stage_conditions add constraint stage_conditions_kind_chk check (kind in ('attachment', 'field', 'tickbox', 'assignment', 'deadline', 'project_evaluation'));
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0064_rename_requirements_to_conditions.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0064_rename_requirements_to_conditions.sql
--
-- Aligns database schema with CONTEXT.md domain vocabulary, which mandates
-- "Condition" over "Requirement".
-- ==============================================================================

DO $$ 
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'stage_requirements') THEN
    ALTER TABLE public.stage_requirements RENAME TO stage_conditions;
    ALTER INDEX IF EXISTS public.stage_requirements_stage_idx RENAME TO stage_conditions_stage_idx;
    ALTER TABLE public.stage_conditions RENAME CONSTRAINT stage_requirements_kind_chk TO stage_conditions_kind_chk;
    ALTER POLICY stage_requirements_read ON public.stage_conditions RENAME TO stage_conditions_read;
    ALTER POLICY stage_requirements_write ON public.stage_conditions RENAME TO stage_conditions_write;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sor_requirement_status') THEN
    ALTER TABLE public.sor_requirement_status RENAME TO sor_condition_status;
    ALTER TABLE public.sor_condition_status RENAME COLUMN requirement_id TO condition_id;
    ALTER INDEX IF EXISTS public.sor_requirement_status_opp_idx RENAME TO sor_condition_status_opp_idx;
    ALTER TABLE public.sor_condition_status RENAME CONSTRAINT sor_requirement_status_unique TO sor_condition_status_unique;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0065_chat_reactions_rpc.sql
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION toggle_chat_reaction(
    p_table text,
    p_message_id uuid,
    p_user_id uuid,
    p_emoji text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_metadata jsonb;
    v_reactions jsonb;
    v_users jsonb;
    v_user_idx int;
BEGIN
    IF p_table = 'task_activity' THEN
        SELECT COALESCE(metadata, '{}'::jsonb) INTO v_metadata
        FROM public.task_activity WHERE id = p_message_id;
    ELSIF p_table = 'committee_task_activity' THEN
        SELECT COALESCE(metadata, '{}'::jsonb) INTO v_metadata
        FROM public.committee_task_activity WHERE id = p_message_id;
    ELSE
        RAISE EXCEPTION 'Invalid table %', p_table;
    END IF;

    IF v_metadata IS NULL THEN
        RAISE EXCEPTION 'Message not found';
    END IF;

    v_reactions := COALESCE(v_metadata->'reactions', '{}'::jsonb);
    v_users := COALESCE(v_reactions->p_emoji, '[]'::jsonb);

    -- Find if user is in the array
    SELECT position - 1 INTO v_user_idx
    FROM jsonb_array_elements_text(v_users) WITH ORDINALITY arr(elem, position)
    WHERE elem = p_user_id::text;

    IF v_user_idx IS NOT NULL THEN
        -- Remove user
        v_users := v_users - v_user_idx;
        IF jsonb_array_length(v_users) = 0 THEN
            v_reactions := v_reactions - p_emoji;
        ELSE
            v_reactions := jsonb_set(v_reactions, ARRAY[p_emoji], v_users);
        END IF;
    ELSE
        -- Add user
        v_users := v_users || to_jsonb(p_user_id::text);
        v_reactions := jsonb_set(v_reactions, ARRAY[p_emoji], v_users);
    END IF;

    -- If reactions is empty, we can just remove the key, or leave it empty {}
    IF v_reactions = '{}'::jsonb THEN
        v_metadata := v_metadata - 'reactions';
    ELSE
        v_metadata := jsonb_set(v_metadata, ARRAY['reactions'], v_reactions);
    END IF;

    IF p_table = 'task_activity' THEN
        UPDATE public.task_activity SET metadata = v_metadata WHERE id = p_message_id;
    ELSIF p_table = 'committee_task_activity' THEN
        UPDATE public.committee_task_activity SET metadata = v_metadata WHERE id = p_message_id;
    END IF;

    RETURN v_metadata;
END;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0066_automation_opportunity_links.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Migration to link tasks to sales opportunities

alter table public.tasks
  add column if not exists opportunity_id uuid references public.sales_opportunities(id) on delete set null;

create index if not exists tasks_opportunity_id_idx on public.tasks(opportunity_id);

alter table public.committee_tasks
  add column if not exists opportunity_id uuid references public.sales_opportunities(id) on delete set null;

create index if not exists committee_tasks_opportunity_id_idx on public.committee_tasks(opportunity_id);


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0067_opportunity_odoo_partner.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0067_opportunity_odoo_partner.sql
--
-- Records WHICH Odoo customer a Company came from, so a verified Company can
-- be told apart from a hand-typed one.
--
-- `client_name` (surfaced as "Company" since ADR 0006) is free text and always
-- will be: roughly half of all SORs are registered before a quotation exists,
-- so there is nothing to verify against at registration time. Locking the
-- field was rejected for that reason. Instead, when a Sales Reference is
-- fetched and Odoo answers, the partner behind the name is stored here.
--
-- Nulled by the application the moment somebody edits the Company text away
-- from the fetched value: a verification marker that outlives the value it
-- verified is worse than no marker at all, because it makes an unverified name
-- look checked.
--
-- Nothing reads this column yet. It exists so that "which of our SORs name a
-- real Odoo customer?" becomes answerable later without a backfill that would
-- have to guess.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * One new nullable column with no default â€” catalog-only, no table
--     rewrite, no lengthy lock.
--   * Older frontends do not select it and are unaffected.
--   * Idempotent.
--
-- Run this BEFORE deploying the frontend that reads `odoo_partner_id` â€”
-- PostgREST rejects the whole query when a selected column is missing, which
-- would return an empty SOR register rather than a partial one.
-- ==============================================================================

alter table public.sales_opportunities
  add column if not exists odoo_partner_id bigint;

comment on column public.sales_opportunities.odoo_partner_id is
  'Odoo res.partner id of the commercial partner this SOR''s Company was filled from, or null when the Company was typed by hand. Cleared by the app when the Company text is edited away from the fetched value. See ADR 0006.';


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0067_sales_opportunities_metadata.sql
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sales_opportunities ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0068_remove_trash_stage_conditions.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Remove stage conditions that reference columns that have been deleted from sales_opportunities
DELETE FROM stage_conditions
WHERE kind = 'field' 
AND config->>'column' IN (
    'so_number', 
    'quote_number', 
    'itb_number', 
    'jo_number', 
    'proposal_link', 
    'contact_no', 
    'itb_start', 
    'itb_end'
);


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0068_repair_swapped_company_contact.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0068_repair_swapped_company_contact.sql
--
-- Corrects the 14 SORs whose Company and Contact Person were entered the wrong
-- way round â€” the person's name in `client_name`, the organisation in
-- `contact_person`.
--
-- The field was labelled "Client" until ADR 0006, which reads just as
-- plausibly as the human you deal with as the agency that signs. 14 of 154
-- live records were filled in on that reading. It is not a second convention:
-- 70 records put the organisation in `client_name` and only 15 put one in
-- `contact_person`, and the swapped set includes four consecutive Sales
-- References (S07192/94/95/97) carrying the same "Mark Ferdinand M. Lucas" /
-- "The Office of Civil Defense" pair â€” one salesperson repeating one
-- misreading. The rename to "Company" is what stops it recurring; this
-- migration cleans up what it already caused.
--
-- Scoped to an EXPLICIT id list rather than a pattern. A regex that matched
-- "Government|Corp|Office|..." would find these rows today and then keep
-- firing against rows added later, eventually swapping a record that was
-- right. The list is the whole point: it cannot grow.
--
-- No audit-log rows are written. This is a schema-level data correction, not
-- something a user did, and fabricating 14 "someone edited this" entries would
-- pollute the very history those entries exist to make trustworthy. This file
-- is the record.
--
-- SAFE TO RUN AT ANY TIME:
--   * Touches only the two text columns, only on the listed ids.
--   * A no-op anywhere the ids do not exist (staging has none of them).
--   * Guarded so it cannot double-apply: each row is only swapped while it
--     still holds the values this migration was written against, so a second
--     run â€” or a run after somebody fixed a row by hand â€” changes nothing.
-- ==============================================================================

update public.sales_opportunities as s
   set client_name    = v.org,
       contact_person = v.person
  from (values
    ('9e5010e9-17ce-4029-9f1f-928f994fcfa4'::uuid, 'Jeffrey Santos',          'Mabalacat City Government, MDRRMO'),
    ('4fb5f69f-6fe7-4787-be06-047281590315'::uuid, 'Marko Emmanuel Longjas',  'Tagbilaran City Government'),
    ('7f8a04dd-d4d6-439f-83a2-93db2d9cd6ef'::uuid, 'Francis Valencia',        'Rizal Medical Center'),
    ('38b7bc8e-39e9-48c2-85d5-f375d38f942c'::uuid, 'Mark Ferdinand M. Lucas', 'The Office of Civil Defense'),
    ('b4c41467-d662-4b12-835b-e41273c41b62'::uuid, 'Mark Ferdinand M. Lucas', 'The Office of Civil Defense'),
    ('b803a810-4ded-4002-8a83-bc685304627a'::uuid, 'Mark Ferdinand M. Lucas', 'The Office of Civil Defense'),
    ('9567190e-b3c1-449a-b9f3-86f90ab47890'::uuid, 'Mark Ferdinand M. Lucas', 'The Office of Civil Defense'),
    ('f2546a79-0a89-4e5a-9a1c-517c0e8ae532'::uuid, 'Marie Jane P. Mansalay',  'Cabadbaran City Government'),
    ('ae35d379-c587-4d0e-b8b3-60dbe4908515'::uuid, 'Milagros Alquiza',        'Vigan City Government'),
    ('b0c935ea-02dd-4eaa-8321-9e67a20d4e3b'::uuid, 'Jeffrey Santos',          'Mabalacat City Government, MDRRMO'),
    ('406c3d93-a180-414a-87b5-27710b0ac80b'::uuid, 'Jennifer',                'Subic Bay Metropolitan Authority, Fire and Rescue team'),
    ('616b1cf4-877a-4bf5-8691-0a63536b6e80'::uuid, 'Mark Gelie Pungtilan',    'Region l Special Rescue Force, BFP'),
    ('7a5a3c4c-3920-4128-9ca9-21c589345e32'::uuid, 'Danila G. Albesa',        'Hindang Municipal Government'),
    ('e66ef695-233c-4caa-8b44-f01c3e3724c6'::uuid, 'Marko Emmanuel Longjas',  'Tagbilaran City Government,')
  ) as v(id, person, org)
 where s.id = v.id
   and s.client_name = v.person
   and s.contact_person = v.org;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0069_flow_stage_color.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 20260828090000_flow_stage_color.sql
--
-- Flow Stage color
--
-- flow_stages had no per-Stage color at all (unlike crm_pipeline_stages.theme,
-- migration 0033) â€” every Stage rendered by its role instead (Entry/Won/
-- Terminal/Plain, see FlowCanvasNode's roleOf()). This adds an optional
-- override: null keeps the role-based default, a value picks a Stage's own
-- color regardless of role.
--
-- Constrained to the same named palette StatusBadge and crm_pipeline_stages
-- already use (constants/statusTheme.js) rather than free-form hex, so a Flow
-- Stage's color always renders through the same theme classes the rest of the
-- app does.
-- ==============================================================================

alter table public.flow_stages add column if not exists color text;

alter table public.flow_stages
  drop constraint if exists flow_stages_color_check;
alter table public.flow_stages
  add constraint flow_stages_color_check
  check (color is null or color in ('mauve', 'amber', 'blue', 'red', 'violet', 'orange', 'green'));


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0069_offsets_and_leaves_times.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0069_offsets_and_leaves_times.sql
--
-- Epic: Offsets and Leaves Specific Time
-- Add `start_time` and `end_time` columns to overtime, offset, and SIL request tables.
-- These columns capture the exact time window for the request.
-- ==============================================================================

alter table public.overtime_requests add column if not exists start_time time;
alter table public.overtime_requests add column if not exists end_time time;

alter table public.offset_leaves add column if not exists start_time time;
alter table public.offset_leaves add column if not exists end_time time;

alter table public.sil_leaves add column if not exists start_time time;
alter table public.sil_leaves add column if not exists end_time time;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0070_flow_stage_bracket_label.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0070_flow_stage_bracket_label.sql
--
-- Adds a bracket_label column to flow_stages. Stages sharing the same
-- (case-sensitive) label are grouped and drawn under one bracket on the
-- Flow Canvas â€” see FlowCanvas.jsx's `bracketed` map and
-- StageSettingsPanel.jsx's bracket editor. Null/blank means "no bracket".
-- Freeform text, no length cap: the label is operator-entered and rendered
-- as-is, with no fixed-width UI slot that a cap would be protecting.
-- ==============================================================================

alter table public.flow_stages add column if not exists bracket_label text;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0070_overtime_approved_hours.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0070_overtime_approved_hours.sql
--
-- Ticket #60: the overtime approval path currently credits the requested
-- hours verbatim, with no way for HR to record what was actually rendered.
-- `approved_hours` holds that figure, set when HR decides; NULL until then.
-- ==============================================================================

alter table public.overtime_requests add column if not exists approved_hours numeric;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0071_flow_plans.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0071_flow_plans.sql
--
-- Flow Plans are independent, real-time collaborative sandboxes (FlowCanvas draft mode)
-- They use Yjs CRDTs to sync state and do not touch the active `sales_flows` tables.
-- ==============================================================================

create table if not exists public.flow_plans (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  yjs_state   bytea, -- binary representation of the Yjs document
  created_by  uuid references public.employees (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint flow_plans_name_not_blank check (btrim(name) <> '')
);

-- â”€â”€ RLS â€” configuration: everyone can read and write to collaborate â”€â”€â”€â”€â”€â”€â”€â”€â”€

alter table public.flow_plans enable row level security;

drop policy if exists flow_plans_read on public.flow_plans;
create policy flow_plans_read on public.flow_plans
  for select to authenticated using (true);

drop policy if exists flow_plans_insert on public.flow_plans;
create policy flow_plans_insert on public.flow_plans
  for insert to authenticated
  with check (created_by = public.get_employee_id());

drop policy if exists flow_plans_update on public.flow_plans;
create policy flow_plans_update on public.flow_plans
  for update to authenticated
  using (true)
  with check (true);

drop policy if exists flow_plans_delete on public.flow_plans;
create policy flow_plans_delete on public.flow_plans
  for delete to authenticated
  using (created_by = public.get_employee_id());

-- Broadcast channel for Yjs awareness/presence (if we want to enforce it, though realtime is generally configured at the realtime level, we can ensure the table is in publication if we use Postgres changes, but Yjs usually just uses Supabase Broadcast which doesn't require a table, OR it uses postgres changes on a table. If it uses postgres changes on `flow_plans` for syncing the blob, we need it in the publication).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'flow_plans'
  ) THEN
    alter publication supabase_realtime add table public.flow_plans;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0071_leave_management_capability.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0071_leave_management_capability.sql
--
-- Ticket #61: HR Assistants cannot reach Leaves Manager today because only
-- the HR head carries `is_hr`, and `is_hr` is deliberately not reused for
-- this â€” in production it also grants unscoped INSERT/UPDATE on every
-- employee row. `can_manage_leaves` is a narrower, dedicated capability.
-- ==============================================================================

alter table public.employees add column if not exists can_manage_leaves boolean not null default false;

-- Caller-lookup helper, mirroring is_hr()/is_super_admin() below. Needed
-- because inside the employees table's OWN policies, an unqualified
-- `can_manage_leaves` would mean the TARGET row, not the caller.
create or replace function public.can_manage_leaves()
returns boolean
language sql
security definer
as $function$
  SELECT can_manage_leaves FROM public.employees WHERE email = auth.jwt() ->> 'email';
$function$;

-- A capability holder may reach another employee's row (to move a leave
-- balance while approving); the role-escalation trigger below is what
-- actually restricts which columns they may change once they're in.
alter policy "Allow Super Admin and HR to update employees" on public.employees
using (
  (is_super_admin() = true)
  or (is_hr() = true)
  or (email = 'arkadatax03@gmail.com'::text)
  or (can_manage_leaves() = true)
);

-- Leave/overtime queues: a capability holder works the same queue is_hr does.
alter policy "offset_leaves_select" on public.offset_leaves
using (
  (employee_id = get_employee_id())
  or (status = 'APPROVED'::text)
  or (exists (select 1 from employees e where e.id = get_employee_id() and (e.is_hr or e.is_super_admin or e.can_manage_leaves)))
);

alter policy "offset_leaves_update" on public.offset_leaves
using (
  (employee_id = get_employee_id())
  or (exists (select 1 from employees e where e.id = get_employee_id() and (e.is_hr or e.is_super_admin or e.can_manage_leaves)))
);

alter policy "overtime_requests_select" on public.overtime_requests
using (
  (employee_id = get_employee_id())
  or (exists (select 1 from employees e where e.id = get_employee_id() and (e.is_hr or e.is_super_admin or e.can_manage_leaves)))
);

alter policy "overtime_requests_update" on public.overtime_requests
using (
  (employee_id = get_employee_id())
  or (exists (select 1 from employees e where e.id = get_employee_id() and (e.is_hr or e.is_super_admin or e.can_manage_leaves)))
);

alter policy "sil_leaves_select" on public.sil_leaves
using (
  (employee_id = get_employee_id())
  or (status = 'APPROVED'::text)
  or (exists (select 1 from employees e where e.id = get_employee_id() and (e.is_hr or e.is_super_admin or e.can_manage_leaves)))
);

alter policy "sil_leaves_update" on public.sil_leaves
using (
  (employee_id = get_employee_id())
  or (exists (select 1 from employees e where e.id = get_employee_id() and (e.is_hr or e.is_super_admin or e.can_manage_leaves)))
);

-- Role-escalation trigger: `can_manage_leaves` is protected the same way
-- `is_super_admin` already is (only a super-admin may flip it â€” even an HR
-- user, who can already freely toggle is_hr/is_head on anyone, must not be
-- able to hand out this narrower capability). It also column-scopes what a
-- capability-only caller (not also HR/super-admin) may touch on a DIFFERENT
-- employee's row: just the two leave balances an approval moves, and
-- updated_at. Everything else reverts to its prior value, exactly like the
-- role-flag freeze below already does for is_super_admin/is_hr/is_head.
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_caller_is_super_admin    BOOLEAN;
  v_caller_is_hr             BOOLEAN;
  v_caller_can_manage_leaves BOOLEAN;
BEGIN
  SELECT is_super_admin, is_hr, can_manage_leaves
  INTO   v_caller_is_super_admin, v_caller_is_hr, v_caller_can_manage_leaves
  FROM   public.employees
  WHERE  id = auth.uid();

  IF NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE) THEN
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      NEW.is_super_admin := OLD.is_super_admin;
    END IF;
    IF NEW.is_hr IS DISTINCT FROM OLD.is_hr THEN
      NEW.is_hr := OLD.is_hr;
    END IF;
    IF NEW.is_head IS DISTINCT FROM OLD.is_head THEN
      NEW.is_head := OLD.is_head;
    END IF;
  END IF;

  IF NEW.is_super_admin = TRUE
     AND OLD.is_super_admin = FALSE
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can grant super-admin status.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_manage_leaves IS DISTINCT FROM OLD.can_manage_leaves
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change leave-management access.'
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_can_manage_leaves IS TRUE
     AND NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE)
     AND OLD.id IS DISTINCT FROM auth.uid()
  THEN
    NEW := jsonb_populate_record(OLD, jsonb_build_object(
      'offset_hours_balance', NEW.offset_hours_balance,
      'sil_hours_balance', NEW.sil_hours_balance,
      'updated_at', NEW.updated_at
    ));
  END IF;

  RETURN NEW;
END;
$function$;

-- Seed the two current HR Assistants: sub-department HR, not OJT, and not
-- already privileged (the head already has full access via is_hr/is_head).
-- A one-time application of the documented rule, never evaluated at runtime.
--
-- The trigger just installed above is disabled for this one statement: a
-- migration runs with no authenticated caller (auth.uid() is null), which
-- the trigger correctly treats as "not a super-admin" and refuses.
alter table public.employees disable trigger trg_prevent_role_escalation;

update public.employees
set can_manage_leaves = true
where sub_department = 'HR'
  and employment_status is distinct from 'OJT'
  and is_hr = false
  and is_super_admin = false;

alter table public.employees enable trigger trg_prevent_role_escalation;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0072_allow_all_flow_canvas.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0072_allow_all_flow_canvas.sql
--
-- Relaxes the RLS policies for Flow Canvas tables so that anyone can edit them,
-- not just super-admins.
--
-- Recovered 2026-08-31 from the staging ledger, where it had been applied
-- directly as version 0072 without ever being committed. Its absence from the
-- repo is why the repo numbered flow_canvas_realtime 0072 while staging's
-- ledger records it as 0073. See .scratch/codebase-cleanup/ROLLBACK-REFERENCE.md.
-- ==============================================================================

-- 1. sales_flows
drop policy if exists sales_flows_write on public.sales_flows;

create policy sales_flows_write on public.sales_flows
  for all to authenticated
  using (true)
  with check (true);

-- 2. flow_stages
drop policy if exists flow_stages_write on public.flow_stages;

create policy flow_stages_write on public.flow_stages
  for all to authenticated
  using (true)
  with check (true);

-- 3. flow_edges
drop policy if exists flow_edges_write on public.flow_edges;

create policy flow_edges_write on public.flow_edges
  for all to authenticated
  using (true)
  with check (true);

-- 4. flow_stage_actions
drop policy if exists flow_stage_actions_write on public.flow_stage_actions;

create policy flow_stage_actions_write on public.flow_stage_actions
  for all to authenticated
  using (true)
  with check (true);

-- 5. stage_conditions
drop policy if exists stage_conditions_write on public.stage_conditions;

create policy stage_conditions_write on public.stage_conditions
  for all to authenticated
  using (true)
  with check (true);


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0072_employee_signatures.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0072_employee_signatures.sql
--
-- Ticket #62: an employee draws or uploads a signature once, in their
-- profile. `signature_path` on `employees` always points at the CURRENT
-- version; replacing it writes a new path and leaves the old file alone, so
-- a document signed months ago can still render the signature actually used
-- at the time (once something records which version it signed with).
--
-- The `signatures` bucket and its policies were already applied by hand to
-- staging ahead of this migration, to unblock earlier design work. This
-- migration is idempotent so it is safe to (re)apply to both staging and
-- production, and it is what makes the bucket a tracked, reviewable part of
-- the repo rather than something that only ever lived in the live database.
-- ==============================================================================

alter table public.employees add column if not exists signature_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 204800, array['image/png'])
on conflict (id) do nothing;

-- Path convention: `<employeeId>/<version>.png` â€” the first path segment is
-- the owning employee's id, which is what every policy below keys off.

drop policy if exists "signatures_insert_own" on storage.objects;
create policy "signatures_insert_own"
on storage.objects for insert
with check (
  bucket_id = 'signatures'
  and (storage.foldername(name))[1] = get_employee_id()::text
);

drop policy if exists "signatures_select_own_or_hr" on storage.objects;
create policy "signatures_select_own_or_hr"
on storage.objects for select
using (
  bucket_id = 'signatures'
  and (
    (storage.foldername(name))[1] = get_employee_id()::text
    or exists (
      select 1 from public.employees e
      where e.id = get_employee_id() and (e.is_hr or e.is_super_admin)
    )
  )
);

drop policy if exists "signatures_update_own" on storage.objects;
create policy "signatures_update_own"
on storage.objects for update
using (
  bucket_id = 'signatures'
  and (storage.foldername(name))[1] = get_employee_id()::text
)
with check (
  bucket_id = 'signatures'
  and (storage.foldername(name))[1] = get_employee_id()::text
);

drop policy if exists "signatures_delete_own" on storage.objects;
create policy "signatures_delete_own"
on storage.objects for delete
using (
  bucket_id = 'signatures'
  and (storage.foldername(name))[1] = get_employee_id()::text
);


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0073_flow_canvas_realtime.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0073_flow_canvas_realtime.sql
--
-- Enables Postgres Realtime for Flow Canvas tables so clients can sync
-- multiplayer edits instantly.
-- ==============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sales_flows'
  ) THEN
    alter publication supabase_realtime add table public.sales_flows;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'flow_stages'
  ) THEN
    alter publication supabase_realtime add table public.flow_stages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'flow_edges'
  ) THEN
    alter publication supabase_realtime add table public.flow_edges;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'stage_conditions'
  ) THEN
    alter publication supabase_realtime add table public.stage_conditions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'flow_stage_actions'
  ) THEN
    alter publication supabase_realtime add table public.flow_stage_actions;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0073_leave_groups.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0073_leave_groups.sql
--
-- Ticket #63: leave applications over a date range.
--
-- A multi-day application writes one row per day rather than one row carrying
-- an end date, so the calendar's one-row-is-one-day assumption and the
-- month-boundary date queries keep working unchanged. `leave_group_id` links
-- the day-rows that belong to the same submission. A volatile default means
-- every existing row (and every future single-day application) gets its own
-- distinct group id â€” a single-day application is a group of one, with no
-- special-casing anywhere that reads this column.
-- ==============================================================================

ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS leave_group_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS leave_group_id UUID NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS offset_leaves_leave_group_id_idx ON public.offset_leaves (leave_group_id);
CREATE INDEX IF NOT EXISTS sil_leaves_leave_group_id_idx ON public.sil_leaves (leave_group_id);


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0074_leave_categories_and_forms.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0074_leave_categories_and_forms.sql
--
-- Adds dynamic leave categories and printed form settings (Ticket #64).
-- Allows HR to manage leave categories (instead of being hard-coded) and
-- configure the supervisor/approver names and titles for printed forms.
-- ==============================================================================

create table if not exists public.hr_leave_categories (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  is_active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ordering is what the UI reads
create unique index if not exists hr_leave_categories_sort_order_key
  on public.hr_leave_categories (sort_order);

create table if not exists public.hr_form_settings (
  id integer primary key check (id = 1),
  supervisor_name text not null default '',
  supervisor_title text not null default '',
  approver_name text not null default '',
  approver_title text not null default '201',
  updated_at timestamptz not null default now()
);

-- Insert the single row for form settings
insert into public.hr_form_settings (id, approver_title)
values (1, '201')
on conflict (id) do nothing;

-- Add category_id to the leave tables
alter table public.overtime_requests
  add column if not exists category_id uuid references public.hr_leave_categories(id) on delete set null;

alter table public.offset_leaves
  add column if not exists category_id uuid references public.hr_leave_categories(id) on delete set null;

alter table public.sil_leaves
  add column if not exists category_id uuid references public.hr_leave_categories(id) on delete set null;

-- RLS for Leave Categories
alter table public.hr_leave_categories enable row level security;

drop policy if exists hr_leave_categories_read on public.hr_leave_categories;
create policy hr_leave_categories_read on public.hr_leave_categories
  for select to authenticated using (true);

drop policy if exists hr_leave_categories_write on public.hr_leave_categories;
create policy hr_leave_categories_write on public.hr_leave_categories
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and (e.is_hr or e.is_super_admin)
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and (e.is_hr or e.is_super_admin)
    )
  );

-- RLS for Form Settings
alter table public.hr_form_settings enable row level security;

drop policy if exists hr_form_settings_read on public.hr_form_settings;
create policy hr_form_settings_read on public.hr_form_settings
  for select to authenticated using (true);

drop policy if exists hr_form_settings_write on public.hr_form_settings;
create policy hr_form_settings_write on public.hr_form_settings
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and (e.is_hr or e.is_super_admin)
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      where e.id = public.get_employee_id() and (e.is_hr or e.is_super_admin)
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0075_verification_tokens.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0075_verification_tokens.sql
--
-- Adds public verification tokens for leave, offset, and overtime records.
-- ==============================================================================

-- 1. Add verification tokens
ALTER TABLE public.sil_leaves 
  ADD COLUMN IF NOT EXISTS verification_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex');

ALTER TABLE public.offset_leaves 
  ADD COLUMN IF NOT EXISTS verification_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex');

ALTER TABLE public.overtime_requests 
  ADD COLUMN IF NOT EXISTS verification_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex');

-- 2. Create Rate Limiting Table
CREATE TABLE IF NOT EXISTS public.verification_rate_limits (
  ip_address TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 1,
  last_request TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- This project's Postgres default privileges grant anon/authenticated full
-- DML on newly created public tables. Without RLS, this table is
-- anon-readable (leaking every verifier's IP) and anon-deletable (letting
-- anyone reset their own rate limit). No policies are defined: the only
-- legitimate access is through verify_form_token, a SECURITY DEFINER
-- function that runs as its owner and so bypasses RLS entirely.
ALTER TABLE public.verification_rate_limits ENABLE ROW LEVEL SECURITY;

-- 3. Create RPC for verifying records by token
-- SECURITY DEFINER allows it to read records bypassing RLS for anon access
CREATE OR REPLACE FUNCTION public.verify_form_token(lookup_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  client_ip TEXT;
  rate_limit_row RECORD;
  result_json JSONB;
  settings RECORD;
  found_id UUID;
BEGIN
  -- Extract client IP (Supabase exposes this in request.headers)
  client_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
  IF client_ip IS NULL THEN
    client_ip := 'unknown';
  ELSE
    -- Take the first IP if multiple
    client_ip := split_part(client_ip, ',', 1);
  END IF;

  -- Simple rate limiting logic (e.g., max 20 requests per minute per IP)
  SELECT * INTO rate_limit_row FROM public.verification_rate_limits WHERE ip_address = client_ip;
  IF FOUND THEN
    IF rate_limit_row.last_request > NOW() - INTERVAL '1 minute' THEN
      IF rate_limit_row.request_count >= 20 THEN
        RAISE EXCEPTION 'Rate limit exceeded. Please try again later.';
      ELSE
        UPDATE public.verification_rate_limits 
        SET request_count = request_count + 1, last_request = NOW()
        WHERE ip_address = client_ip;
      END IF;
    ELSE
      UPDATE public.verification_rate_limits 
      SET request_count = 1, last_request = NOW()
      WHERE ip_address = client_ip;
    END IF;
  ELSE
    INSERT INTO public.verification_rate_limits (ip_address, request_count, last_request)
    VALUES (client_ip, 1, NOW());
  END IF;

  -- Fetch default form settings for fallback approver
  SELECT * INTO settings FROM public.hr_form_settings WHERE id = 1;

  -- Try SIL Leaves
  SELECT jsonb_build_object(
    'form_type', 'Leave',
    'employee_name', e.first_name || ' ' || e.last_name,
    'category', c.label,
    'inclusive_dates', to_char(s.date, 'Mon DD, YYYY'),
    'total_hours', s.hours,
    'status', s.status,
    'approver_name', COALESCE(hr.first_name || ' ' || hr.last_name, settings.approver_name),
    'approval_date', COALESCE(to_char(s.hr_processed_at, 'Mon DD, YYYY'), to_char(s.updated_at, 'Mon DD, YYYY'))
  ) INTO result_json
  FROM public.sil_leaves s
  JOIN public.employees e ON s.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON s.category_id = c.id
  LEFT JOIN public.employees hr ON s.hr_processed_by = hr.id
  WHERE s.verification_token = lookup_token;

  IF FOUND THEN
    RETURN result_json;
  END IF;

  -- Try Offset Leaves
  SELECT jsonb_build_object(
    'form_type', 'Offset',
    'employee_name', e.first_name || ' ' || e.last_name,
    'category', c.label,
    'inclusive_dates', to_char(o.date, 'Mon DD, YYYY'),
    'total_hours', o.hours,
    'status', o.status,
    'approver_name', settings.approver_name,
    'approval_date', to_char(o.updated_at, 'Mon DD, YYYY')
  ) INTO result_json
  FROM public.offset_leaves o
  JOIN public.employees e ON o.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON o.category_id = c.id
  WHERE o.verification_token = lookup_token;

  IF FOUND THEN
    RETURN result_json;
  END IF;

  -- Try Overtime Requests
  SELECT jsonb_build_object(
    'form_type', 'Overtime',
    'employee_name', e.first_name || ' ' || e.last_name,
    'category', c.label,
    'inclusive_dates', to_char(ot.date, 'Mon DD, YYYY'),
    'total_hours', ot.hours,
    'status', ot.status,
    'approver_name', settings.approver_name,
    'approval_date', to_char(ot.updated_at, 'Mon DD, YYYY')
  ) INTO result_json
  FROM public.overtime_requests ot
  JOIN public.employees e ON ot.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON ot.category_id = c.id
  WHERE ot.verification_token = lookup_token;

  IF FOUND THEN
    RETURN result_json;
  END IF;

  -- If not found
  RETURN NULL;
END;
$$;

-- Ensure public access to the verification endpoint
GRANT EXECUTE ON FUNCTION public.verify_form_token(TEXT) TO anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0076_form_signatures.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0076_form_signatures.sql
--
-- Adds signature and hash tracking to offset_leaves, sil_leaves, and overtime_requests.
-- Fixes an issue in 0075_verification_tokens.sql where e.first_name was used instead of e.name.
-- Updates verify_form_token to return the new hashing and signature fields,
-- and gathers group-level raw data so the client can verify the hashes.
-- ==============================================================================

-- 1. Add signature columns to sil_leaves
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS application_hash TEXT;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS approval_hash TEXT;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS employee_signature_version TEXT;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS employee_signature_timestamp TIMESTAMPTZ;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS hr_signature_version TEXT;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS hr_signature_timestamp TIMESTAMPTZ;
ALTER TABLE public.sil_leaves ADD COLUMN IF NOT EXISTS approval_credits_snapshot NUMERIC;

-- 2. Add signature columns to offset_leaves
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS application_hash TEXT;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS approval_hash TEXT;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS employee_signature_version TEXT;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS employee_signature_timestamp TIMESTAMPTZ;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS hr_signature_version TEXT;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS hr_signature_timestamp TIMESTAMPTZ;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS approval_credits_snapshot NUMERIC;
ALTER TABLE public.offset_leaves ADD COLUMN IF NOT EXISTS hr_processed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;

-- 3. Add signature columns to overtime_requests
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS application_hash TEXT;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS approval_hash TEXT;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS employee_signature_version TEXT;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS employee_signature_timestamp TIMESTAMPTZ;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS hr_signature_version TEXT;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS hr_signature_timestamp TIMESTAMPTZ;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS approval_credits_snapshot NUMERIC;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS hr_processed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;

-- 4. Recreate verify_form_token to fix e.name and include new fields + raw group data
CREATE OR REPLACE FUNCTION public.verify_form_token(lookup_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  client_ip TEXT;
  rate_limit_row RECORD;
  result_json JSONB;
  settings RECORD;
  found_id UUID;
  group_dates TEXT[];
  group_hours NUMERIC;
BEGIN
  -- Extract client IP
  client_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
  IF client_ip IS NULL THEN
    client_ip := 'unknown';
  ELSE
    client_ip := split_part(client_ip, ',', 1);
  END IF;

  -- Simple rate limiting logic
  SELECT * INTO rate_limit_row FROM public.verification_rate_limits WHERE ip_address = client_ip;
  IF FOUND THEN
    IF rate_limit_row.last_request > NOW() - INTERVAL '1 minute' THEN
      IF rate_limit_row.request_count >= 20 THEN
        RAISE EXCEPTION 'Rate limit exceeded. Please try again later.';
      ELSE
        UPDATE public.verification_rate_limits 
        SET request_count = request_count + 1, last_request = NOW()
        WHERE ip_address = client_ip;
      END IF;
    ELSE
      UPDATE public.verification_rate_limits 
      SET request_count = 1, last_request = NOW()
      WHERE ip_address = client_ip;
    END IF;
  ELSE
    INSERT INTO public.verification_rate_limits (ip_address, request_count, last_request)
    VALUES (client_ip, 1, NOW());
  END IF;

  SELECT * INTO settings FROM public.hr_form_settings WHERE id = 1;

  -- Try SIL Leaves
  SELECT jsonb_build_object(
    'form_type', 'Leave',
    'employee_name', e.name,
    'employee_id', e.id,
    'category', c.label,
    'category_id', s.category_id,
    'inclusive_dates', to_char(s.date, 'Mon DD, YYYY'),
    'raw_date', s.date,
    'reason', s.reason,
    'status', s.status,
    'approver_name', COALESCE(hr.name, settings.approver_name),
    'approver_id', s.hr_processed_by,
    'approval_date', COALESCE(to_char(s.hr_processed_at, 'Mon DD, YYYY'), to_char(s.updated_at, 'Mon DD, YYYY')),
    'application_hash', s.application_hash,
    'approval_hash', s.approval_hash,
    'employee_signature_version', s.employee_signature_version,
    'employee_signature_timestamp', s.employee_signature_timestamp,
    'hr_signature_version', s.hr_signature_version,
    'hr_signature_timestamp', s.hr_signature_timestamp,
    'leave_group_id', s.leave_group_id,
    'approval_credits_snapshot', s.approval_credits_snapshot
  ) INTO result_json
  FROM public.sil_leaves s
  JOIN public.employees e ON s.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON s.category_id = c.id
  LEFT JOIN public.employees hr ON s.hr_processed_by = hr.id
  WHERE s.verification_token = lookup_token;

  IF FOUND THEN
    SELECT array_agg(date::TEXT ORDER BY date), sum(hours) INTO group_dates, group_hours 
    FROM public.sil_leaves WHERE leave_group_id = (result_json->>'leave_group_id')::UUID;
    
    result_json := result_json || jsonb_build_object('group_dates', group_dates, 'total_hours', group_hours);
    RETURN result_json;
  END IF;

  -- Try Offset Leaves
  SELECT jsonb_build_object(
    'form_type', 'Offset',
    'employee_name', e.name,
    'employee_id', e.id,
    'category', c.label,
    'category_id', o.category_id,
    'inclusive_dates', to_char(o.date, 'Mon DD, YYYY'),
    'raw_date', o.date,
    'reason', o.reason,
    'status', o.status,
    'approver_name', COALESCE(hr.name, settings.approver_name),
    'approver_id', o.hr_processed_by,
    'approval_date', to_char(o.updated_at, 'Mon DD, YYYY'),
    'application_hash', o.application_hash,
    'approval_hash', o.approval_hash,
    'employee_signature_version', o.employee_signature_version,
    'employee_signature_timestamp', o.employee_signature_timestamp,
    'hr_signature_version', o.hr_signature_version,
    'hr_signature_timestamp', o.hr_signature_timestamp,
    'leave_group_id', o.leave_group_id,
    'approval_credits_snapshot', o.approval_credits_snapshot
  ) INTO result_json
  FROM public.offset_leaves o
  JOIN public.employees e ON o.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON o.category_id = c.id
  LEFT JOIN public.employees hr ON o.hr_processed_by = hr.id
  WHERE o.verification_token = lookup_token;

  IF FOUND THEN
    SELECT array_agg(date::TEXT ORDER BY date), sum(hours) INTO group_dates, group_hours 
    FROM public.offset_leaves WHERE leave_group_id = (result_json->>'leave_group_id')::UUID;

    result_json := result_json || jsonb_build_object('group_dates', group_dates, 'total_hours', group_hours);
    RETURN result_json;
  END IF;

  -- Try Overtime Requests
  SELECT jsonb_build_object(
    'form_type', 'Overtime',
    'employee_name', e.name,
    'employee_id', e.id,
    'category', c.label,
    'category_id', ot.category_id,
    'inclusive_dates', to_char(ot.date, 'Mon DD, YYYY'),
    'raw_date', ot.date,
    'total_hours', ot.hours,
    'group_dates', array[ot.date::TEXT],
    'reason', ot.reason,
    'status', ot.status,
    'approver_name', COALESCE(hr.name, settings.approver_name),
    'approver_id', ot.hr_processed_by,
    'approval_date', to_char(ot.updated_at, 'Mon DD, YYYY'),
    'application_hash', ot.application_hash,
    'approval_hash', ot.approval_hash,
    'employee_signature_version', ot.employee_signature_version,
    'employee_signature_timestamp', ot.employee_signature_timestamp,
    'hr_signature_version', ot.hr_signature_version,
    'hr_signature_timestamp', ot.hr_signature_timestamp,
    'approval_credits_snapshot', ot.approval_credits_snapshot
  ) INTO result_json
  FROM public.overtime_requests ot
  JOIN public.employees e ON ot.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON ot.category_id = c.id
  LEFT JOIN public.employees hr ON ot.hr_processed_by = hr.id
  WHERE ot.verification_token = lookup_token;

  IF FOUND THEN
    RETURN result_json;
  END IF;

  -- If not found
  RETURN NULL;
END;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0077_role_escalation_fix.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0077_role_escalation_fix.sql
--
-- Ticket #72: prevent_role_escalation resolves the caller via
-- `employees.id = auth.uid()`, but in this schema employees.id and
-- auth.users.id are different id spaces (zero of 45 employee rows match by
-- id). That silently blinds every branch of the trigger, including the one
-- meant to narrow a capability-only holder's write to just the two leave
-- balances, and refuses every Super Admin can_manage_leaves grant/revoke.
--
-- Fix: resolve the caller with get_employee_id(), the helper every other
-- policy/function in this migration set already uses. Also gives the
-- "Allow Super Admin and HR to update employees" policy an explicit
-- WITH CHECK matching its USING clause â€” without one, Postgres reuses USING
-- as the check, which means the trigger's column-scoping was the only thing
-- narrowing a capability holder's write, and that enforcement was silently
-- off for the same reason above.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id                UUID;
  v_caller_is_super_admin    BOOLEAN;
  v_caller_is_hr             BOOLEAN;
  v_caller_can_manage_leaves BOOLEAN;
BEGIN
  v_caller_id := public.get_employee_id();

  SELECT is_super_admin, is_hr, can_manage_leaves
  INTO   v_caller_is_super_admin, v_caller_is_hr, v_caller_can_manage_leaves
  FROM   public.employees
  WHERE  id = v_caller_id;

  IF NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE) THEN
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      NEW.is_super_admin := OLD.is_super_admin;
    END IF;
    IF NEW.is_hr IS DISTINCT FROM OLD.is_hr THEN
      NEW.is_hr := OLD.is_hr;
    END IF;
    IF NEW.is_head IS DISTINCT FROM OLD.is_head THEN
      NEW.is_head := OLD.is_head;
    END IF;
  END IF;

  IF NEW.is_super_admin = TRUE
     AND OLD.is_super_admin = FALSE
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can grant super-admin status.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_manage_leaves IS DISTINCT FROM OLD.can_manage_leaves
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change leave-management access.'
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_can_manage_leaves IS TRUE
     AND NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE)
     AND OLD.id IS DISTINCT FROM v_caller_id
  THEN
    NEW := jsonb_populate_record(OLD, jsonb_build_object(
      'offset_hours_balance', NEW.offset_hours_balance,
      'sil_hours_balance', NEW.sil_hours_balance,
      'updated_at', NEW.updated_at
    ));
  END IF;

  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS "Allow Super Admin and HR to update employees" ON public.employees;
CREATE POLICY "Allow Super Admin and HR to update employees" ON public.employees
  FOR UPDATE
  USING (
    (is_super_admin() = true) OR (is_hr() = true) OR (email = 'arkadatax03@gmail.com'::text) OR (can_manage_leaves() = true)
  )
  WITH CHECK (
    (is_super_admin() = true) OR (is_hr() = true) OR (email = 'arkadatax03@gmail.com'::text) OR (can_manage_leaves() = true)
  );


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0078_leave_categories_seed.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0078_leave_categories_seed.sql
--
-- Ticket #71: hr_leave_categories (added by 0074) has never been seeded on
-- production. The apply form's category picker reads this table, so with it
-- empty no employee can submit a leave, offset, or overtime application at
-- all. Seeded from the category list this codebase's own pre-#64 hardcoded
-- record.type -> label map used (src/lib/pdf/layout.js), which is the best
-- record of production's real category list.
-- ==============================================================================

INSERT INTO public.hr_leave_categories (label, sort_order) VALUES
  ('Sick Leave', 1),
  ('Vacation Leave', 2),
  ('Maternity Leave', 3),
  ('Paternity Leave', 4),
  ('Bereavement Leave', 5),
  ('Emergency Leave', 6),
  ('Solo Parent Leave', 7),
  ('Magna Carta for Women', 8),
  ('VAWC Leave', 9)
ON CONFLICT DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0079_verify_form_token_hash_verdicts.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0079_verify_form_token_hash_verdicts.sql
--
-- Ticket #76: verify_form_token used to return the raw reason and every raw
-- hash-input field (application_hash, approval_hash, employee_id,
-- category_id, raw_date) so the client could recompute the hash itself and
-- compare. That's exactly what #65's "reason and attachments absent from the
-- unauthenticated response itself" requirement rules out â€” an anonymous
-- caller could always read `reason` straight off the RPC response, hash
-- comparison notwithstanding.
--
-- This version computes both comparisons itself and returns two booleans,
-- application_valid and approval_valid, in their place. Numeric hash inputs
-- (total hours, the credits snapshot) are canonicalized with trim_scale() so
-- a Postgres NUMERIC and the JS float sum that produced it hash identically
-- â€” see src/utils/formHashes.js's canonicalNumber(), which the write side
-- and this function must agree on byte-for-byte.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.verify_form_token(lookup_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  client_ip TEXT;
  rate_limit_row RECORD;
  result_json JSONB;
  settings RECORD;
  rec RECORD;
  group_dates TEXT[];
  group_hours NUMERIC;
  dates_string TEXT;
  canon_hours TEXT;
  canon_credits TEXT;
  computed_app_hash TEXT;
  computed_appr_hash TEXT;
  app_valid BOOLEAN;
  appr_valid BOOLEAN;
BEGIN
  -- Extract client IP
  client_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
  IF client_ip IS NULL THEN
    client_ip := 'unknown';
  ELSE
    client_ip := split_part(client_ip, ',', 1);
  END IF;

  -- Simple rate limiting logic
  SELECT * INTO rate_limit_row FROM public.verification_rate_limits WHERE ip_address = client_ip;
  IF FOUND THEN
    IF rate_limit_row.last_request > NOW() - INTERVAL '1 minute' THEN
      IF rate_limit_row.request_count >= 20 THEN
        RAISE EXCEPTION 'Rate limit exceeded. Please try again later.';
      ELSE
        UPDATE public.verification_rate_limits
        SET request_count = request_count + 1, last_request = NOW()
        WHERE ip_address = client_ip;
      END IF;
    ELSE
      UPDATE public.verification_rate_limits
      SET request_count = 1, last_request = NOW()
      WHERE ip_address = client_ip;
    END IF;
  ELSE
    INSERT INTO public.verification_rate_limits (ip_address, request_count, last_request)
    VALUES (client_ip, 1, NOW());
  END IF;

  SELECT * INTO settings FROM public.hr_form_settings WHERE id = 1;

  -- Try SIL Leaves
  SELECT s.*, e.name AS employee_name, c.label AS category_label,
         hr.name AS hr_name
  INTO rec
  FROM public.sil_leaves s
  JOIN public.employees e ON s.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON s.category_id = c.id
  LEFT JOIN public.employees hr ON s.hr_processed_by = hr.id
  WHERE s.verification_token = lookup_token;

  IF FOUND THEN
    SELECT array_agg(date::TEXT ORDER BY date), sum(hours) INTO group_dates, group_hours
    FROM public.sil_leaves WHERE leave_group_id = rec.leave_group_id;

    dates_string := array_to_string(group_dates, ',');
    canon_hours := COALESCE(trim_scale(round(group_hours, 2))::text, '');
    computed_app_hash := encode(digest(
      format('%s|%s|%s|%s|%s', rec.employee_id, COALESCE(rec.category_id::text, ''), dates_string, canon_hours, COALESCE(rec.reason, '')),
      'sha256'), 'hex');
    app_valid := (rec.application_hash IS NOT NULL) AND (computed_app_hash = rec.application_hash);

    appr_valid := NULL;
    IF rec.approval_hash IS NOT NULL AND (rec.status LIKE 'APPROVED%' OR rec.status = 'REJECTED') THEN
      canon_credits := CASE WHEN rec.approval_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(rec.approval_credits_snapshot, 2))::text END;
      computed_appr_hash := encode(digest(
        format('%s|%s|%s|%s', rec.application_hash, rec.status, COALESCE(rec.hr_processed_by::text, ''), canon_credits),
        'sha256'), 'hex');
      appr_valid := (computed_appr_hash = rec.approval_hash);
    END IF;

    result_json := jsonb_build_object(
      'form_type', 'Leave',
      'employee_name', rec.employee_name,
      'category', rec.category_label,
      'inclusive_dates', to_char(rec.date, 'Mon DD, YYYY'),
      'total_hours', group_hours,
      'status', rec.status,
      'approver_name', COALESCE(rec.hr_name, settings.approver_name),
      'approval_date', COALESCE(to_char(rec.hr_processed_at, 'Mon DD, YYYY'), to_char(rec.updated_at, 'Mon DD, YYYY')),
      'application_valid', app_valid,
      'approval_valid', appr_valid,
      'employee_signature_timestamp', rec.employee_signature_timestamp,
      'hr_signature_timestamp', rec.hr_signature_timestamp
    );
    RETURN result_json;
  END IF;

  -- Try Offset Leaves
  SELECT o.*, e.name AS employee_name, c.label AS category_label,
         hr.name AS hr_name
  INTO rec
  FROM public.offset_leaves o
  JOIN public.employees e ON o.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON o.category_id = c.id
  LEFT JOIN public.employees hr ON o.hr_processed_by = hr.id
  WHERE o.verification_token = lookup_token;

  IF FOUND THEN
    SELECT array_agg(date::TEXT ORDER BY date), sum(hours) INTO group_dates, group_hours
    FROM public.offset_leaves WHERE leave_group_id = rec.leave_group_id;

    dates_string := array_to_string(group_dates, ',');
    canon_hours := COALESCE(trim_scale(round(group_hours, 2))::text, '');
    computed_app_hash := encode(digest(
      format('%s|%s|%s|%s|%s', rec.employee_id, COALESCE(rec.category_id::text, ''), dates_string, canon_hours, COALESCE(rec.reason, '')),
      'sha256'), 'hex');
    app_valid := (rec.application_hash IS NOT NULL) AND (computed_app_hash = rec.application_hash);

    appr_valid := NULL;
    IF rec.approval_hash IS NOT NULL AND (rec.status LIKE 'APPROVED%' OR rec.status = 'REJECTED') THEN
      canon_credits := CASE WHEN rec.approval_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(rec.approval_credits_snapshot, 2))::text END;
      computed_appr_hash := encode(digest(
        format('%s|%s|%s|%s', rec.application_hash, rec.status, COALESCE(rec.hr_processed_by::text, ''), canon_credits),
        'sha256'), 'hex');
      appr_valid := (computed_appr_hash = rec.approval_hash);
    END IF;

    result_json := jsonb_build_object(
      'form_type', 'Offset',
      'employee_name', rec.employee_name,
      'category', rec.category_label,
      'inclusive_dates', to_char(rec.date, 'Mon DD, YYYY'),
      'total_hours', group_hours,
      'status', rec.status,
      'approver_name', COALESCE(rec.hr_name, settings.approver_name),
      'approval_date', to_char(rec.updated_at, 'Mon DD, YYYY'),
      'application_valid', app_valid,
      'approval_valid', appr_valid,
      'employee_signature_timestamp', rec.employee_signature_timestamp,
      'hr_signature_timestamp', rec.hr_signature_timestamp
    );
    RETURN result_json;
  END IF;

  -- Try Overtime Requests
  SELECT ot.*, e.name AS employee_name, c.label AS category_label,
         hr.name AS hr_name
  INTO rec
  FROM public.overtime_requests ot
  JOIN public.employees e ON ot.employee_id = e.id
  LEFT JOIN public.hr_leave_categories c ON ot.category_id = c.id
  LEFT JOIN public.employees hr ON ot.hr_processed_by = hr.id
  WHERE ot.verification_token = lookup_token;

  IF FOUND THEN
    canon_hours := COALESCE(trim_scale(round(rec.hours, 2))::text, '');
    computed_app_hash := encode(digest(
      format('%s|%s|%s|%s|%s', rec.employee_id, COALESCE(rec.category_id::text, ''), rec.date::TEXT, canon_hours, COALESCE(rec.reason, '')),
      'sha256'), 'hex');
    app_valid := (rec.application_hash IS NOT NULL) AND (computed_app_hash = rec.application_hash);

    appr_valid := NULL;
    IF rec.approval_hash IS NOT NULL AND (rec.status LIKE 'APPROVED%' OR rec.status = 'REJECTED') THEN
      canon_credits := CASE WHEN rec.approval_credits_snapshot IS NULL THEN '' ELSE trim_scale(round(rec.approval_credits_snapshot, 2))::text END;
      computed_appr_hash := encode(digest(
        format('%s|%s|%s|%s', rec.application_hash, rec.status, COALESCE(rec.hr_processed_by::text, ''), canon_credits),
        'sha256'), 'hex');
      appr_valid := (computed_appr_hash = rec.approval_hash);
    END IF;

    result_json := jsonb_build_object(
      'form_type', 'Overtime',
      'employee_name', rec.employee_name,
      'category', rec.category_label,
      'inclusive_dates', to_char(rec.date, 'Mon DD, YYYY'),
      'total_hours', rec.hours,
      'status', rec.status,
      'approver_name', COALESCE(rec.hr_name, settings.approver_name),
      'approval_date', to_char(rec.updated_at, 'Mon DD, YYYY'),
      'application_valid', app_valid,
      'approval_valid', appr_valid,
      'employee_signature_timestamp', rec.employee_signature_timestamp,
      'hr_signature_timestamp', rec.hr_signature_timestamp
    );
    RETURN result_json;
  END IF;

  -- If not found
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_form_token(TEXT) TO anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0080_leave_select_scope.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0080_leave_select_scope.sql
--
-- Ticket #77: offset_leaves_select and sil_leaves_select let ANY signed-in
-- employee read ANY other employee's APPROVED record (the bare
-- `status = 'APPROVED'` OR-branch), reason and attachments included â€” not
-- just a summary. That's what let an unrelated employee pull someone else's
-- medical reason through the verification page's authenticated branch.
--
-- Scope SELECT to: the record's own employee, or HR / Super Admin / a
-- leave-management capability holder (who needs read access to actually work
-- the approval queue #61 built them for).
-- ==============================================================================

DROP POLICY IF EXISTS offset_leaves_select ON public.offset_leaves;
CREATE POLICY offset_leaves_select ON public.offset_leaves
  FOR SELECT
  USING (
    (employee_id = get_employee_id())
    OR (EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = get_employee_id() AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves)
    ))
  );

DROP POLICY IF EXISTS sil_leaves_select ON public.sil_leaves;
CREATE POLICY sil_leaves_select ON public.sil_leaves
  FOR SELECT
  USING (
    (employee_id = get_employee_id())
    OR (EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = get_employee_id() AND (e.is_hr OR e.is_super_admin OR e.can_manage_leaves)
    ))
  );


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0081_tester_role_escalation_fix.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0081_tester_role_escalation_fix.sql
--
-- Fixes an issue where the exception account (arkadatax03@gmail.com) loses the
-- ability to escalate its role back to Super Admin via the RoleSwitcher.
-- The prevent_role_escalation trigger was rejecting updates that granted 
-- super_admin/hr status when the caller (the tester account in simulation)
-- did not currently hold those roles.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id                UUID;
  v_caller_is_super_admin    BOOLEAN;
  v_caller_is_hr             BOOLEAN;
  v_caller_can_manage_leaves BOOLEAN;
  v_caller_email             TEXT;
BEGIN
  v_caller_id := public.get_employee_id();

  SELECT is_super_admin, is_hr, can_manage_leaves, email
  INTO   v_caller_is_super_admin, v_caller_is_hr, v_caller_can_manage_leaves, v_caller_email
  FROM   public.employees
  WHERE  id = v_caller_id;

  -- Bypasses role escalation checks for the tester exception account
  IF v_caller_email = 'arkadatax03@gmail.com' THEN
    RETURN NEW;
  END IF;

  IF NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE) THEN
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      NEW.is_super_admin := OLD.is_super_admin;
    END IF;
    IF NEW.is_hr IS DISTINCT FROM OLD.is_hr THEN
      NEW.is_hr := OLD.is_hr;
    END IF;
    IF NEW.is_head IS DISTINCT FROM OLD.is_head THEN
      NEW.is_head := OLD.is_head;
    END IF;
  END IF;

  IF NEW.is_super_admin = TRUE
     AND OLD.is_super_admin = FALSE
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can grant super-admin status.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_manage_leaves IS DISTINCT FROM OLD.can_manage_leaves
     AND NOT (v_caller_is_super_admin IS TRUE)
  THEN
    RAISE EXCEPTION
      'Insufficient privileges: only a super-admin can change leave-management access.'
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_can_manage_leaves IS TRUE
     AND NOT (v_caller_is_super_admin IS TRUE OR v_caller_is_hr IS TRUE)
     AND OLD.id IS DISTINCT FROM v_caller_id
  THEN
    NEW := jsonb_populate_record(OLD, jsonb_build_object(
      'offset_hours_balance', NEW.offset_hours_balance,
      'sil_hours_balance', NEW.sil_hours_balance,
      'updated_at', NEW.updated_at
    ));
  END IF;

  RETURN NEW;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 0082_printed_tracking.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 0082_printed_tracking.sql
--
-- HR Document Center (issue #81): a printed batch stamps every record it
-- included so the picker can show "already printed" instead of HR relying on
-- memory. Non-blocking â€” informational only, never prevents reprinting.
-- ==============================================================================

alter table public.sil_leaves add column if not exists printed_at timestamptz;
alter table public.sil_leaves add column if not exists printed_by uuid references public.employees(id);

alter table public.offset_leaves add column if not exists printed_at timestamptz;
alter table public.offset_leaves add column if not exists printed_by uuid references public.employees(id);

alter table public.overtime_requests add column if not exists printed_at timestamptz;
alter table public.overtime_requests add column if not exists printed_by uuid references public.employees(id);


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 20260831044418_stage_conditions_new_kinds.sql
-- ────────────────────────────────────────────────────────────────────────────
-- ==============================================================================
-- 20260831044418_stage_conditions_new_kinds.sql
--
-- Adding inclusions and purchasing to stage conditions.
-- ==============================================================================

alter table public.stage_conditions drop constraint if exists stage_conditions_kind_chk;

alter table public.stage_conditions add constraint stage_conditions_kind_chk check (kind in (
  'attachment', 'field', 'tickbox', 'assignment', 'deadline', 'project_evaluation', 'inclusions', 'purchasing'
));


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 20260831044621_group_task_member_attachments.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Originally 0041_group_task_member_attachments.sql on main. Version 0041 was
-- already claimed in this ledger by stage_requirements, so it would never have
-- applied under its old name. Re-issued under the timestamp convention (ADR 0007).

ALTER TABLE public.committee_task_members ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;


-- ────────────────────────────────────────────────────────────────────────────
-- SOURCE: 20260831044632_chat_reaction_rls_and_realtime.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Add UPDATE RLS policies so Supabase Realtime can broadcast reaction UPDATE
-- events, and add committee_task_activity to the realtime publication so
-- group-task chats get realtime events.
--
-- Originally 0066_chat_reaction_rls_and_realtime.sql on main. Version 0066 was
-- already claimed in this ledger by automation_opportunity_links, so it would
-- never have applied under its old name. Re-issued under the timestamp
-- convention (ADR 0007), and made re-runnable so the production run is safe.

-- 1. UPDATE policy for task_activity
DROP POLICY IF EXISTS "Authenticated users can update task activity" ON public.task_activity;
CREATE POLICY "Authenticated users can update task activity"
  ON public.task_activity FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 2. UPDATE policy for committee_task_activity
DROP POLICY IF EXISTS "Authenticated users can update committee task activity" ON public.committee_task_activity;
CREATE POLICY "Authenticated users can update committee task activity"
  ON public.committee_task_activity FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 3. Add committee_task_activity to realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'committee_task_activity'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.committee_task_activity;
  END IF;
END $$;


