-- Part of the Commission Pool feature (#10), this ticket #13.
--
-- Contract Date anchors which dated Commission Rate applies to an
-- opportunity. It is set automatically when an opportunity transitions to
-- Awarded (src/services/opportunityService.js:updateStatus) and is not
-- otherwise editable.

alter table public.sales_opportunities
  add column if not exists contract_date date;
