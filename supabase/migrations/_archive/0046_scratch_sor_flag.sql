-- ==============================================================================
-- 0046_scratch_sor_flag.sql
--
-- The Scratch SOR flag (issue #36 — Flow Canvas). A Scratch SOR is an ordinary
-- SOR that exists only to be pushed through a Sales Flow so its behaviour can
-- be watched. It runs IDENTICAL code paths to a production record — that is the
-- whole point, and it is why this is a flag on `sales_opportunities` rather
-- than a parallel table. A separate table would mean a second implementation of
-- every rule, and "it runs for real" would become a claim rather than a fact.
--
-- WHAT THE FLAG COSTS, AND WHY IT IS PAID HERE
-- Identical code paths mean a Scratch SOR is indistinguishable from a real deal
-- to every query that does not ask. So every AGGREGATE read must ask. This
-- migration ships the column BEFORE the canvas can create the first Scratch
-- SOR, so there is never a window in which one exists and the aggregates have
-- not been taught to exclude it.
--
-- The call sites, enumerated (issue #36, "Scratch SORs, environment and
-- access"). Aggregates — these filter:
--   * opportunityService.getOpportunities  — the SOR Register list, and so the
--     board, the matrix, every register count, and the batched blocked-deal and
--     deadline reads that take its output as their input.
--   * commissionService.getCommissionDashboardData — commission totals.
--   * commissionService.isSalesDirector — a Scratch SOR naming somebody as
--     Sales Director must not hand that person the Commission Dashboard.
--   * stageRequirementService.noteArchivalOnDealsAtStage — a scratch record
--     does not need a timeline note about a config change.
--
-- Single-row reads by id do NOT filter, and must not: the canvas opens a
-- Scratch SOR, its Group Tasks link back to it, and its procurement requests
-- resolve their parent deal. A Scratch SOR that could not be opened could not
-- be watched.
--
-- WHY NOT REUSE is_deleted
-- `is_deleted` means "this was withdrawn"; scratch means "this was never real".
-- Collapsing them would make discarding a Scratch SOR and soft-deleting a live
-- deal the same event in the timeline, and would hide scratch records from the
-- canvas that has to show them.
--
-- The partial index matches the aggregate predicate (`is_scratch = false`), so
-- the register's own read is the one that stays covered. Scratch rows are few
-- and only ever read by id or by flow, so they need no index of their own.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * One new column with a NOT NULL DEFAULT false — every existing row becomes
--     non-scratch, which is what every existing row is.
--   * No existing row changes meaning, and no running frontend selects it.
--   * A frontend deployed before this migration keeps working: it never names
--     the column, and the default makes its inserts valid.
--   * Idempotent.
-- ==============================================================================

alter table public.sales_opportunities
  add column if not exists is_scratch boolean not null default false;

comment on column public.sales_opportunities.is_scratch is
  'Scratch SOR (issue #36): exists only to exercise a Sales Flow on staging. Runs identical code paths to a real deal; excluded from every aggregate read.';

-- Matches the aggregate predicate rather than indexing the scratch rows: the
-- reads that must stay fast are the register's, and they all ask for the
-- non-scratch side.
create index if not exists sales_opportunities_live_idx
  on public.sales_opportunities (registration_date desc, created_at desc)
  where is_scratch = false and is_deleted = false;
