-- ============================================================================
-- Grants Sales Opportunity Register access to every active employee, by
-- setting employees.has_sales_flow = true. This is a one-time data change,
-- not a schema migration — run it directly in the Supabase SQL editor.
--
-- has_sales_flow now controls ONLY the Opportunity Register nav link (in
-- SideNav.jsx) and whether the dashboard fetches opportunity data at all
-- (pages/index.jsx). It no longer gates the old sales module — that's been
-- removed. It is NOT an access-control boundary: /opportunities itself has
-- no route guard, and read/write permissions are enforced by RLS on the
-- database side regardless of this flag. Flipping it for everyone just
-- surfaces the nav link and dashboard widget broadly, matching the
-- regulation's "every lead (possible sales) needs to be logged" — any
-- employee, not just a formal sales team, should be able to register one.
-- ============================================================================

-- Pre-flight: how many active employees currently lack access.
select count(*) as employees_to_grant
from public.employees
where coalesce(is_deleted, false) = false
  and coalesce(has_sales_flow, false) = false;

-- The change.
update public.employees
set has_sales_flow = true
where coalesce(is_deleted, false) = false;

-- Verify: should return 0.
select count(*) as still_missing_access
from public.employees
where coalesce(is_deleted, false) = false
  and coalesce(has_sales_flow, false) = false;
