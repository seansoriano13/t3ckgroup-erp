-- Backfills contract_date for opportunities already sitting at Awarded or
-- beyond without one.
--
-- WHY: migration 0030 added the column but did not backfill, and the only
-- code path that set it fired on a transition to AWARDED exactly. Two cases
-- slipped through and between them caught every realized deal in production:
--
--   1. An opportunity registered directly at a realized stage. It never
--      passes through updateStatus, so nothing ever set the date. Four of the
--      five realized rows had created_at = updated_at to the microsecond,
--      which is what this looks like.
--   2. A deal moved past Awarded in one step — straight to PO Received or
--      Closed Won. The old `nextStatus === "AWARDED"` test did not match.
--
-- Both are fixed in opportunityService (createOpportunity now stamps the date
-- when a row is registered at a realized stage, and updateStatus tests
-- REALIZED_STAGES rather than the single AWARDED value). This migration
-- repairs the rows that predate that fix.
--
-- WHICH DATE: the true award date was never recorded, so there is nothing to
-- recover it from. updated_at is the closest honest proxy — for rows
-- registered straight into a realized stage it is the registration moment,
-- and for the rest it is the last time the row moved. Anything more precise
-- would be invention.
--
-- EFFECT ON FIGURES: none today. Every commission_rates row is effective
-- 2026-01-01 and every opportunity was created in 2026-08, so each of these
-- deals already resolves to the same VAT/Withholding/Pool percentages whether
-- it is priced by contract_date or by today's date. What this restores is the
-- guarantee for the future: once a second dated rate exists, an already-
-- awarded deal keeps the rate that applied when it was awarded instead of
-- silently repricing.
--
-- Safe to re-run: the WHERE clause excludes rows that already have a date.

update public.sales_opportunities
   set contract_date = updated_at::date
 where contract_date is null
   and status in (
     'AWARDED',
     'PO_RECEIVED',
     'PROJECT_DELIVERY',
     'COLLECTION',
     'CLOSED_WON',
     'RETENTION'
   );

-- Verification — expect zero rows after running:
--
--   select id, status, contract_date
--     from public.sales_opportunities
--    where contract_date is null
--      and status in ('AWARDED','PO_RECEIVED','PROJECT_DELIVERY',
--                     'COLLECTION','CLOSED_WON','RETENTION');
