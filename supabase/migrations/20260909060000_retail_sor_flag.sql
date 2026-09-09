-- ==============================================================================
-- 20260909060000_retail_sor_flag.sql
--
-- The Retail flag (issue #170/#171). A retail order (Shopee, Lazada, any
-- marketplace storefront) is registered as an ordinary SOR because the Odoo
-- sync writes to the same table as a human sales rep — it is not a separate
-- kind of record, it is a real row that happens to describe a sale with no
-- proposal, no bidding, no negotiation and no award. Mirrors is_scratch
-- (issue #36, migration 0046) exactly: same shape, same reasoning, applied at
-- the same call sites, because a flagged column that already has five other
-- readers migrates out far more easily than a fresh column would migrate in.
--
-- WHY NOT REUSE is_scratch
-- Scratch means "this was never real"; retail means "this is real and closed,
-- but does not belong in the pipeline, the commission engine or any register
-- that measures sales activity". Collapsing them would make a Flow Canvas
-- rehearsal and a completed Shopee order the same kind of exclusion, which
-- they are not — a retail record still owns a real sales reference and a real
-- amount (issue #174 keeps them, reclassified, never deleted).
--
-- THE CALL SITES, ENUMERATED (issue #171) — same six as is_scratch:
--   * opportunityService.getOpportunities       — the Register, board, matrix,
--     and every batched read that takes the Register's output as its input.
--   * commissionService.getCommissionDashboardData — commission totals.
--   * commissionService.isSalesDirector          — approving one retail order
--     must not hand the approver Commission Split write access.
--   * purchasingService.listOpenQueue            — a retail SOR raises no
--     procurement requests, but the join-level guard matches its siblings.
--   * stageConditionService.noteConditionEventOnDealsAtStage — a retail
--     record has no timeline anybody reads for its own sake.
--   * salesFlowService.getSnapshotUsageCounts    — retail never ran a Sales
--     Flow, so it must not appear in a flow's live-usage count.
--
-- Single-row reads by id do NOT filter, matching is_scratch: the Retail tab
-- (issue #174) opens a retail record directly, and it must be able to.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * One new column with a NOT NULL DEFAULT false — every existing row
--     becomes non-retail, which is what every existing row already is until
--     issue #174's migration reclassifies the seven that are actually retail.
--   * No existing row changes meaning, and no running frontend selects it.
--   * Idempotent.
-- ==============================================================================

alter table public.sales_opportunities
  add column if not exists is_retail boolean not null default false;

comment on column public.sales_opportunities.is_retail is
  'Retail SOR (issue #170/#171): a marketplace order (Shopee/Lazada) registered as an SOR by the Odoo sync but excluded from the pipeline, commission engine and every aggregate read. Real and never deleted — see the Retail tab.';

-- Matches the is_scratch partial index: the predicate the aggregates actually
-- ask for is both flags false, so extend the existing covering index instead
-- of adding a second one that would never be chosen alongside it.
drop index if exists public.sales_opportunities_live_idx;

create index if not exists sales_opportunities_live_idx
  on public.sales_opportunities (registration_date desc, created_at desc)
  where is_scratch = false and is_retail = false and is_deleted = false;
