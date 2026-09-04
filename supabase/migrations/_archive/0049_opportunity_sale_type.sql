-- ==============================================================================
-- 0049_opportunity_sale_type.sql
--
-- An SOR carries a Sale Type, and sits on a Stage of that Sale Type's flow
-- (issue #36, ADR 0006).
--
-- TWO STAGE COLUMNS, ON PURPOSE, FOR NOW
-- `status` names a row in `crm_pipeline_stages` — the single global ordered
-- pipeline every existing deal, board, gate and report is built on.
-- `flow_stage_id` names a row in `flow_stages` — a Stage private to one Sales
-- Flow. They are different spaces and neither can be expressed as the other,
-- so an SOR is one of two things:
--
--   * sale_type_id IS NULL — a legacy deal. It moves through the global
--     pipeline and is gated exactly as it was before this migration existed.
--   * sale_type_id IS NOT NULL — a flow-built deal. It sits on flow_stage_id
--     and its moves are the edges the Operations Manager drew.
--
-- This is the expand half of an expand–contract. Migrating existing SORs onto
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
  'Issue #36: the Stage of its own flow this deal sits on. Paired with sale_type_id — both set, or neither.';
