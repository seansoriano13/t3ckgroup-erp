-- APPLIED 2026-08-22 (tracked in Supabase as migration "sales_reference_unique").
-- Kept here so the repo carries the same statement the database is running.
--
-- Makes the Odoo quotation number unique, which is what it has meant since
-- migration 0025 retired opportunity_no in its favour — while the UNIQUE index
-- stayed behind on the retired column and sales_reference got only a plain
-- lookup index:
--
--   sales_opportunities_opportunity_no_key    UNIQUE (opportunity_no)   -- dead column
--   sales_opportunities_sales_reference_idx   btree  (sales_reference)  -- live identifier
--
-- Two quotations ended up anchoring two opportunities each (S08106 at
-- PHP 126,000 and S07995 at PHP 46,620), and the Commission Pool priced every
-- row independently: one Odoo quotation, two lots of Commissionable Revenue —
-- PHP 1,035.00 of realized pool and PHP 382.95 of pipeline counted twice.
-- Those pairs were merged by scripts/merge-duplicate-sor.sql before this index
-- could be created.
--
-- Partial on purpose:
--   * sales_reference is null until an opportunity is quoted — a legitimate
--     state, since the stage gate is what makes the reference mandatory
--     (requiresSalesReference), not the field itself.
--   * soft-deleted rows are excluded, so retiring a duplicate by setting
--     is_deleted frees its reference for the surviving record. That is what
--     makes the merge script's soft delete work.
--
-- The application checks this too — opportunityService.assertSalesReferenceUnused
-- runs on create, edit and stage transition — so a user gets a message naming
-- the conflicting deal rather than a raw constraint violation. This index is
-- the backstop for anything writing through the anon key directly.

create unique index if not exists sales_opportunities_sales_reference_key
  on public.sales_opportunities (sales_reference)
  where sales_reference is not null
    and coalesce(is_deleted, false) = false;
