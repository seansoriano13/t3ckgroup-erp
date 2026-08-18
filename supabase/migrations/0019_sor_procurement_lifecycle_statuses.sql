-- ==============================================================================
-- 0019_sor_procurement_lifecycle_statuses.sql
--
-- Expands procurement request outcome statuses to support the 3-step lifecycle:
--   1. IN_PROGRESS - Purchasing is actively canvassing suppliers / comparing quotes (no PO yet)
--   2. PURCHASED   - PO raised in Odoo, goods in transit from vendor (replaces ON_ORDER)
--   3. DELIVERED   - Goods physically arrived at company warehouse/office, ready for client delivery
--
-- Preserves existing alternative terminal outcomes:
--   - ALREADY_EXISTS (in Odoo under different name)
--   - SUBSTITUTED    (different product sourced, needs PO)
--   - UNAVAILABLE    (cannot be sourced)
--
-- Keeps ON_ORDER as a valid alias for backward compatibility: the backfill
-- below rewrites today's rows, but a frontend still running the previous build
-- would fail its writes against a constraint that had dropped the value.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Widens a CHECK constraint — every value that was legal before still is.
--   * The backfill only rewrites ON_ORDER, which the app now spells PURCHASED.
--   * Idempotent — safe to re-run.
-- ==============================================================================

alter table public.sor_procurement_requests
  drop constraint if exists sor_procurement_requests_outcome_check;

alter table public.sor_procurement_requests
  add constraint sor_procurement_requests_outcome_check
  check (outcome in (
    'IN_PROGRESS',
    'PURCHASED',
    'DELIVERED',
    'ON_ORDER',
    'ALREADY_EXISTS',
    'SUBSTITUTED',
    'UNAVAILABLE'
  ));

-- Backfill any existing ON_ORDER rows to PURCHASED
update public.sor_procurement_requests
  set outcome = 'PURCHASED'
  where outcome = 'ON_ORDER';

-- Reload schema cache
notify pgrst, 'reload schema';
