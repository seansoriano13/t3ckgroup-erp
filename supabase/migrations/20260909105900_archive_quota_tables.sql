-- allow-out-of-order: must run before 20260909110000_drop_deprecated_quota_tables (#329)
--
-- #329 (release/2026-09, #325): 20260909110000 drops six Quota System tables
-- that still hold 6,344 rows in production (sales_activity_logs 4,241,
-- sales_activities 1,895, sales_revenue_logs 102, sales_weekly_plans 62,
-- sales_quotas 24, sales_quota_logs 20). This copies them into an
-- `archive_quota` schema first, so the preservation is reproducible and in the
-- ledger rather than a one-off by hand.
--
-- Deliberately timestamped before the drop. The drop itself is not edited —
-- the migration set is append-only.
--
-- On production this runs in order, ahead of the drop, and copies everything.
-- Staging already ran the drop: `migrate-staging` pushes with --include-all,
-- so it applies this out of order, finds no source tables and skips each one.
-- The header marker above is what lets scripts/check-migration-order.mjs pass
-- a file that sorts before staging's tip.
--
-- Plain `create table ... as table`: data and column types, no constraints,
-- indexes, triggers or RLS. It's a record, not a live table. Not exposed
-- through PostgREST; only the service role / postgres read it.

create schema if not exists archive_quota;
revoke all on schema archive_quota from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'sales_quotas',
    'sales_quota_logs',
    'sales_weekly_plans',
    'sales_activities',
    'sales_activity_logs',
    'sales_revenue_logs'
  ] loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'archive_quota: public.% does not exist, skipping', t;
    elsif to_regclass(format('archive_quota.%I', t)) is not null then
      raise notice 'archive_quota: archive_quota.% already exists, skipping', t;
    else
      execute format('create table archive_quota.%I as table public.%I', t, t);
      execute format('revoke all on archive_quota.%I from public, anon, authenticated', t);
    end if;
  end loop;
end
$$;
