-- 20261105030000_purchase_request_number_triggers_not_callable.sql
--
-- The two Purchase Request number trigger functions (20261104100000, #683) were left with
-- Postgres' default EXECUTE for PUBLIC, so anon could call them. Nothing calls them but the
-- triggers, which run as the table's writer. Take the grant away, the same as every other
-- trigger function of the request (policy test 50, "no #209 function is executable by anon or
-- public"). Idempotent.

revoke all on function public.purchase_requests_assign_number() from public, anon, authenticated;
revoke all on function public.purchase_requests_keep_number() from public, anon, authenticated;
