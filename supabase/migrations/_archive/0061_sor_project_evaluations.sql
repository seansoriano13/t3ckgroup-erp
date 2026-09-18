-- ==============================================================================
-- 0061_sor_project_evaluations.sql
--
-- Project Evaluation (issue #38 vocabulary; this ticket #48) — the go/no-go.
-- One record per SOR, holding the numbers a salesperson decides a project on:
-- a candidate sales price, an estimated operating expense figure, and whether
-- the client is a government body (which is what turns the VAT/Withholding/
-- Retention deduction sequence on).
--
-- ── One per SOR, and it may exist before Odoo does ──────────────────────────
-- opportunity_id is UNIQUE: an SOR gets at most one Project Evaluation, not a
-- history of them — sign-off is what records a decision was made, not a new
-- row. NOT NULL and ON DELETE CASCADE because an evaluation with no SOR to
-- decide about is meaningless. No requirement that the SOR carry a Sales
-- Reference: the whole point (per the parent issue) is that the decision
-- often comes before the deal exists in Odoo at all.
--
-- ── Base cost is NOT a column here ───────────────────────────────────────────
-- It rolls up live from the SOR's Inclusions and their stamped costs
-- (constants/projectEvaluation.js rollUpBaseCost, migration 0060's cost_amount
-- column) every time the evaluation is read, the same way Completeness already
-- does. Storing a second copy would drift from the Inclusions the moment any
-- one of them is re-costed.
--
-- ── Candidate price, never a price Odoo sees ────────────────────────────────
-- candidate_sales_price is what this record is for deciding with. It is never
-- written to Odoo — markup and final pricing stay there, per the parent
-- issue's explicit decision. Where it differs from the Odoo order's own price
-- (sales_opportunities.expected_value, once bound), both are shown with the
-- delta; nothing here reconciles them.
--
-- ── Sign-off is recorded, not required ──────────────────────────────────────
-- signed_off_by / signed_off_at exist so a decision has an owner. Nothing in
-- this migration enforces sign-off happening before anything else — ticket #50
-- gates a Stage on the *existence* of a Project Evaluation, explicitly not on
-- whether it has been signed off.
--
-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Read is org-wide, matching every other SOR-scoped table.
--
-- Write mirrors sor_can_edit_opportunity (0003) — the same sales participants,
-- heads and super admins who may edit the SOR itself. This is a sales decision
-- about a sales deal, unlike Inclusions/Canvass which purchasing also writes
-- to; there is deliberately no has_purchasing_flow clause here.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Creates a new table. No deployed frontend selects it.
--   * No existing row, table or policy is modified.
--   * Idempotent — safe to re-run.
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
  'Issue #48. The go/no-go: candidate price, estimated opex and the government-deduction toggle, one row per SOR. Base cost is not stored here — it rolls up live from sor_inclusions.cost_amount.';
