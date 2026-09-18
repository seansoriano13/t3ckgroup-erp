-- ==============================================================================
-- 0022_sor_procurement_odoo_vendor.sql
--
-- Captures the Odoo purchase order's vendor (partner_id) alongside the
-- product ref and ETA that resolveRequest already snapshots from
-- odoo-po-verify. Without this, `vendor` only lived in the edit form's local
-- state (see procurementService.verifyPoNumber) and vanished the moment the
-- form closed — nobody downstream could ever see who a PO went to.
--
-- Odoo-derived only, same as odoo_product_ref: no UI writes this directly,
-- and it is left null on rows resolved before this migration rather than
-- backfilled — re-querying Odoo for every historical row to populate a
-- display field is not worth the extra Odoo/Supabase calls.
--
-- SAFE TO RUN AT ANY TIME, against a live production frontend of any version:
--   * Additive column only, nullable, no default computation.
--   * No existing row, policy, or index is modified.
--   * Idempotent — safe to re-run.
-- ==============================================================================

alter table public.sor_procurement_requests
  add column if not exists odoo_vendor text;
