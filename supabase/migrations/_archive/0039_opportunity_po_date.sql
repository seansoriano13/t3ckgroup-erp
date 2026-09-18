-- ==============================================================================
-- 0039_opportunity_po_date.sql
--
-- Splits "Purchase Date/Order" into the two things it has been doing at once.
--
-- `expected_award_date` was labelled "Purchase Date/Order" in the UI while
-- being named as a forecast in the schema, and production shows BOTH meanings
-- in live use, split cleanly by stage:
--
--     Lead / Proposal Submitted / Bid Submitted  16 filled,  7 FUTURE dated
--     Awarded / PO Received / Closed Won          3 filled,  0 future dated
--
-- Pre-award people type a forecast ("we expect the award around then"), which
-- is what the column name means. Post-award every filled value is in the past
-- — a record of a purchase order that happened, which is what the label means.
--
-- Renaming the column to a PO date (or to Contract Date) would therefore have
-- silently reclassified seven forecasts sitting in Lead and Proposal Submitted
-- as facts. So the column keeps its name and gets its honest label back, and
-- the fact gets a column of its own.
--
-- `po_date` is the date printed on the attached PO document — NOT the day
-- somebody moved the deal to PO Received, which can trail it by days. Making
-- it *required* on entering PO Received is deliberately not done here: that is
-- a "field" requirement for the stage-gate engine (decision D6 in
-- docs/crm-pipeline-redesign.md), not a NOT NULL constraint, because 128 of
-- 129 existing rows would violate one.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * One new nullable column with no default — catalog-only, no table
--     rewrite, no lengthy lock.
--   * Older frontends do not select it and are unaffected.
--   * The backfill below only COPIES; it never clears expected_award_date, so
--     nothing is lost and the statement is safe to re-run.
--   * Idempotent.
--
-- Run this BEFORE deploying the frontend that reads `po_date` — PostgREST
-- rejects the whole query when a selected column is missing, which would
-- return an empty SOR register rather than a partial one.
-- ==============================================================================

alter table public.sales_opportunities
  add column if not exists po_date date;

comment on column public.sales_opportunities.po_date is
  'Date printed on the client''s purchase order document, read off the attachment. Not the day the deal was moved to PO Received.';

comment on column public.sales_opportunities.expected_award_date is
  'Pre-award forecast of when the award is expected. Surfaced as "Expected Award Date". Was mislabelled "Purchase Date/Order" until 0039; see po_date for the fact.';

-- Carry the three post-award values over to where they belong. A past date on
-- a booked deal, entered under a label reading "Purchase Date/Order", is a PO
-- date by any reasonable reading. Copy rather than move: the original is left
-- untouched so this is reversible and loses nothing if the reading is wrong.
update public.sales_opportunities s
   set po_date = s.expected_award_date
  from public.crm_pipeline_stages st
 where st.code = s.status
   and st.sort_order >= (select sort_order from public.crm_pipeline_stages where is_anchor)
   and not st.is_lost
   and s.expected_award_date is not null
   and s.expected_award_date <= current_date
   and s.po_date is null;
