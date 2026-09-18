-- ==============================================================================
-- 20260909070000_retail_storefront_list.sql
--
-- Issue #172 — retail detection moves from parsing words out of an Odoo note
-- to matching the Odoo customer against a configurable storefront list.
-- Lead source is explicitly not the signal (production has a government
-- proposal tagged Shopee), so the list has to live somewhere an admin can
-- change it without a redeploy. app_settings is already that place — the
-- singleton config row every settings read goes through — so this adds a
-- column there instead of a new table for what is, today, two strings.
--
-- Matching is substring/case-insensitive against the Odoo partner name (e.g.
-- "Shopee T3ck Outdoor" matches "Shopee"), done in the edge function.
-- ==============================================================================

alter table public.app_settings
  add column if not exists retail_storefronts text[] not null default '{Shopee,Lazada}'::text[];

comment on column public.app_settings.retail_storefronts is
  'Issue #172: Odoo customer-name fragments (case-insensitive substring) that mark a sale.order as retail. Lead source is deliberately not used for this.';
