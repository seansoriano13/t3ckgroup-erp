-- Issue #177 — three app_settings columns with no interface anywhere.
--
-- require_revenue_verification is read by update_sales_quota_metrics(),
-- but that trigger function is never attached to any table (its body is
-- an unimplemented stub for the deprecated Quota System, which spec 16
-- removes separately) — so it is dead code, not a real reader.
-- allow_reported_to_reassignment and sales_self_approve_expenses have no
-- reader anywhere, frontend or database.
alter table public.app_settings
  drop column if exists require_revenue_verification,
  drop column if exists allow_reported_to_reassignment,
  drop column if exists sales_self_approve_expenses;
