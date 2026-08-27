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
-- commission figure exactly as it was — see commission.js, where
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
