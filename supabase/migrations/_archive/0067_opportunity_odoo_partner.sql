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
--   * One new nullable column with no default — catalog-only, no table
--     rewrite, no lengthy lock.
--   * Older frontends do not select it and are unaffected.
--   * Idempotent.
--
-- Run this BEFORE deploying the frontend that reads `odoo_partner_id` —
-- PostgREST rejects the whole query when a selected column is missing, which
-- would return an empty SOR register rather than a partial one.
-- ==============================================================================

alter table public.sales_opportunities
  add column if not exists odoo_partner_id bigint;

comment on column public.sales_opportunities.odoo_partner_id is
  'Odoo res.partner id of the commercial partner this SOR''s Company was filled from, or null when the Company was typed by hand. Cleared by the app when the Company text is edited away from the fetched value. See ADR 0006.';
