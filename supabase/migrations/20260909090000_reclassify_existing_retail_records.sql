-- ==============================================================================
-- 20260909090000_reclassify_existing_retail_records.sql
--
-- Issue #174 — the seven production records #170 found (all registered at
-- Lead, marked ITB-exempt, and stuck at Payment Verification forever because
-- a marketplace order has no next step) are reclassified as retail. Matched
-- on the storefront customer, the same signal issue #172 uses going forward
-- — not lead_source, which is spoofable and already wrong elsewhere in
-- production (a real government proposal is tagged Shopee).
--
-- Nothing is deleted: each of these carries a real sales_reference (an
-- Odoo SO number) and a real amount. Marking is_retail = true is enough to
-- remove them from every register, board, matrix and commission read
-- (issue #171) while leaving the row, and its history, intact for the
-- Retail tab to show.
-- ==============================================================================

update public.sales_opportunities
set is_retail = true
where is_deleted = false
  and is_retail = false
  and exists (
    select 1
    from unnest(
      coalesce(
        (select retail_storefronts from public.app_settings limit 1),
        array['Shopee', 'Lazada']
      )
    ) as storefront
    where client_name ilike '%' || storefront || '%'
  );
