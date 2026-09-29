#!/usr/bin/env bash
# #336: rehearse the production cutover (docs/production-cutover-runbook.md,
# steps 3-7, step labels match) against a throwaway copy of production. Never writes to prod:
# prod is only read by pg_dump. Runs on a CI runner with the local Supabase
# stack started (`supabase start`), see .github/workflows/cutover-rehearsal.yml.
#
# Needs PROD_DB_URL (read: dump) and STAGING_DB_URL (read: flow transfer).
set -euo pipefail

DB_CONTAINER=supabase_db_t3ckgroup-erp-local
LOCAL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

step() { echo; echo "════ $* ════"; }
psql_local() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q "$@"; }
scalar() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X -At -c "$1"; }
fail() { echo "✖ REHEARSAL FAILED: $*" >&2; exit 1; }

step "3. pg_dump production (read-only) and restore it as the stand-in for prod"
# Prod archived the quota tables on 2026-09-23, so they may already sit in
# archive_quota. Count them wherever they are.
QS=$(docker exec "$DB_CONTAINER" psql "$PROD_DB_URL" -X -At -c   "select case when to_regclass('public.sales_quotas') is null then 'archive_quota' else 'public' end")
echo "prod quota tables in schema: $QS"
PRE_COUNTS=$(docker exec "$DB_CONTAINER" psql "$PROD_DB_URL" -X -At -c "
  select string_agg(t || '=' || n, ' ' order by t) from (
    select 'sales_quotas' t, count(*) n from $QS.sales_quotas union all
    select 'sales_quota_logs', count(*) from $QS.sales_quota_logs union all
    select 'sales_weekly_plans', count(*) from $QS.sales_weekly_plans union all
    select 'sales_activities', count(*) from $QS.sales_activities union all
    select 'sales_activity_logs', count(*) from $QS.sales_activity_logs union all
    select 'sales_revenue_logs', count(*) from $QS.sales_revenue_logs) x")
echo "prod quota row counts: $PRE_COUNTS"
PROD_APPROVED_DIFF=$(docker exec "$DB_CONTAINER" psql "$PROD_DB_URL" -X -At -c \
  "select count(*) from public.offset_leaves where approved_hours is not null and approved_hours is distinct from hours")
echo "prod offset rows with approved_hours != hours: $PROD_APPROVED_DIFF"

docker exec "$DB_CONTAINER" pg_dump "$PROD_DB_URL" -n public -n supabase_migrations -n archive_quota \
  --no-owner --no-privileges --format=plain -f /tmp/prod.sql
docker exec "$DB_CONTAINER" sh -c 'wc -c /tmp/prod.sql'

# Everything the repo migrations created on the empty stack goes, so only
# prod's own state remains (archive_quota included: left behind, it would
# make the archive migration skip as "already exists").
psql_local -c "drop schema if exists public cascade; drop schema if exists supabase_migrations cascade; drop schema if exists archive_quota cascade;"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q -f /tmp/prod.sql
psql_local <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL
echo "restored. ledger:"; scalar "select string_agg(version, ' ' order by version) from supabase_migrations.schema_migrations"

# Prod's ledger was already repaired on 2026-09-23; each repair only runs if
# its row still needs it, same as runbook step 4.
has() { scalar "select count(*) from supabase_migrations.schema_migrations where version='$1'"; }
step "4. repair: revert the orphan 20260914013100 (if present)"
if [ "$(has 20260914013100)" != "0" ]; then supabase migration repair --status reverted 20260914013100 --db-url "$LOCAL"; else echo "already gone"; fi

step "4. repair: mark the baseline 20260904000000 applied (if missing)"
if [ "$(has 20260904000000)" = "0" ]; then supabase migration repair --status applied 20260904000000 --db-url "$LOCAL"; else echo "already applied"; fi

step "4. check: ledger check must be clean"
PROD_DB_URL="$LOCAL" node scripts/db-ledger-check.mjs prod --include-all || fail "ledger check blocked"

step "5. migrate: supabase db push --include-all (as migrate-prod include_all)"
supabase db push --include-all --db-url "$LOCAL" --yes

step "5. check: ledger clean after push"
PROD_DB_URL="$LOCAL" node scripts/db-ledger-check.mjs prod || fail "ledger not clean after push"
PENDING=$(PROD_DB_URL="$LOCAL" node scripts/db-ledger-check.mjs prod | grep -c "^    2026" || true)
[ "$PENDING" = "0" ] || fail "$PENDING migrations still pending after push"

step "5. check: verify the schema"
DIFF_AFTER=$(scalar "select count(*) from public.offset_leaves where approved_hours is not null and approved_hours is distinct from hours")
echo "approved_hours != hours: before $PROD_APPROVED_DIFF, after $DIFF_AFTER"
[ "$DIFF_AFTER" = "$PROD_APPROVED_DIFF" ] || fail "approved_hours not preserved"
POST_COUNTS=$(scalar "
  select string_agg(table_name || '=' || n, ' ' order by table_name) from (
    select 'sales_quotas' table_name, count(*) n from archive_quota.sales_quotas union all
    select 'sales_quota_logs', count(*) from archive_quota.sales_quota_logs union all
    select 'sales_weekly_plans', count(*) from archive_quota.sales_weekly_plans union all
    select 'sales_activities', count(*) from archive_quota.sales_activities union all
    select 'sales_activity_logs', count(*) from archive_quota.sales_activity_logs union all
    select 'sales_revenue_logs', count(*) from archive_quota.sales_revenue_logs) x")
echo "archive_quota: $POST_COUNTS"
[ "$POST_COUNTS" = "$PRE_COUNTS" ] || fail "archive_quota counts differ from prod"
LEFT=$(scalar "select count(*) from information_schema.tables where table_schema='public' and table_name in ('sales_quotas','sales_quota_logs','sales_weekly_plans','sales_activities','sales_activity_logs','sales_revenue_logs')")
[ "$LEFT" = "0" ] || fail "$LEFT quota tables still in public"
POLICIES=$(scalar "select count(*) from pg_policies where tablename in ('sor_stage_visits','sor_stage_participants') and policyname like '%_read' and qual like '%sor_access_level%'")
[ "$POLICIES" = "2" ] || fail "visit/participant read policies not narrowed ($POLICIES)"

# Runbook 6a-6c. Prod already holds both flows (same ids); only Government is
# newer on staging (v5 vs v4, 2026-09-29), so only it is replaced.
step "6a. replace Government from staging"
node scripts/transfer-sales-flows.mjs --from staging --to-url "$LOCAL" --replace --apply Government

step "6b. Group Task Templates (done on prod 2026-09-29; transfer only if missing)"
# Prod already got them (same ids, tagged) before 2026-09-29; transfer only if not.
if [ "$(scalar "select count(*) from public.group_task_templates where name like '% (staging%'")" = "0" ]; then
  node scripts/transfer-group-task-templates.mjs --from staging --to-url "$LOCAL" --tag-all --apply
else
  echo "already on prod: $(scalar "select count(*) from public.group_task_templates") templates"
fi

step "6c. repoint Government's Project Delivery template to prod's DELIVERY"
node scripts/repoint-government-delivery-template.mjs --to prod --to-url "$LOCAL" --apply

step "7. Legacy Pipeline rename and backfill"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X < supabase/scripts/cutover/legacy_pipeline_backfill.sql
NULLS=$(scalar "select count(*) from public.sales_opportunities where sale_type_id is null and coalesce(is_deleted,false)=false")
[ "$NULLS" = "0" ] || fail "$NULLS non-deleted SORs without a Sale Type"
LEG=$(scalar "select count(*) from public.sale_types where name = 'Legacy Pipeline'")
[ "$LEG" = "1" ] || fail "expected one Sale Type named Legacy Pipeline, found $LEG"
echo "re-run (idempotent):"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X < supabase/scripts/cutover/legacy_pipeline_backfill.sql

step "RLS: spot-check SOR visibility as real employees"
# visible_as <email> [where]: how many non-deleted SORs this employee can read.
# Legacy Pipeline is open to Everyone by design (ADR 0021, 2026-09-25
# amendment), so the Deal Team checks only count SORs outside it.
LEGACY="(select st.id from public.sale_types st where st.name = 'Legacy Pipeline')"
NONLEGACY="coalesce(is_deleted,false)=false and sale_type_id is distinct from $LEGACY"
visible_as() {
  # One -c string = one session; psql also echoes SET, so keep the last line.
  scalar "set role authenticated;
    select set_config('request.jwt.claims', json_build_object('email', '$1', 'role', 'authenticated')::text, false);
    select count(*) from public.sales_opportunities where $2;" | tail -1
}
ALL="coalesce(is_deleted,false)=false"
TOTAL=$(scalar "select count(*) from public.sales_opportunities where $ALL")
LEG_TOTAL=$(scalar "select count(*) from public.sales_opportunities where $ALL and sale_type_id = $LEGACY")
NL_TOTAL=$(scalar "select count(*) from public.sales_opportunities where $NONLEGACY")
ADMIN=$(scalar "select email from public.employees where is_super_admin and email is not null limit 1")
OUTSIDER=$(scalar "select e.email from public.employees e
  where e.email is not null and not coalesce(e.is_super_admin,false) and not coalesce(e.is_hr,false)
    and not exists (select 1 from public.sales_opportunities o where e.id in
      (o.registered_by, o.deal_owner_id, o.support_sales_1_id, o.sales_director_id, o.closing_sales_id))
  limit 1")
A=$(visible_as "$ADMIN" "$ALL"); XL=$(visible_as "$OUTSIDER" "$ALL and sale_type_id = $LEGACY"); XN=$(visible_as "$OUTSIDER" "$NONLEGACY")
echo "non-deleted SORs: $TOTAL (Legacy $LEG_TOTAL, other flows $NL_TOTAL) | Super Admin sees $A | outsider sees Legacy $XL, other flows $XN"
[ "$A" = "$TOTAL" ] || fail "Super Admin sees $A of $TOTAL"
[ "$XL" = "$LEG_TOTAL" ] || fail "Legacy Pipeline not open to Everyone: outsider sees $XL of $LEG_TOTAL"
[ "$XN" = "0" ] || fail "an employee on no Deal Team sees $XN non-Legacy SORs"

step "RLS: Deal Team privacy on a throwaway Government SOR (clone only)"
# Prod has no Government SORs yet, so make one on the clone: a copy of any SOR,
# moved to Government, owned by a non-admin who isn't the outsider. Triggers
# are off for the insert only (stage guards don't matter to a read test).
OWNER_ID=$(scalar "select e.id from public.employees e
  where e.email is not null and not coalesce(e.is_super_admin,false) and not coalesce(e.is_hr,false)
    and e.email <> '$OUTSIDER' limit 1")
OWNER=$(scalar "select email from public.employees where id = '$OWNER_ID'")
psql_local <<SQL
set session_replication_role = replica;
create temp table zz as select * from public.sales_opportunities limit 1;
update zz set id = gen_random_uuid(),
  serial_no = (select coalesce(max(serial_no),0) + 1 from public.sales_opportunities),
  opportunity_no = null, sor_code = null, sales_reference = 'ZZREHEARSAL', is_deleted = false,
  sale_type_id = (select id from public.sale_types where name = 'Government'),
  registered_by = '$OWNER_ID', deal_owner_id = '$OWNER_ID',
  closing_sales_id = null, support_sales_1_id = null, support_sales_2_id = null, sales_director_id = null;
insert into public.sales_opportunities select * from zz;
SQL
GOV="sales_reference = 'ZZREHEARSAL'"
GO=$(visible_as "$OWNER" "$GOV"); GX=$(visible_as "$OUTSIDER" "$GOV")
echo "throwaway Government SOR: its owner sees $GO, an outsider sees $GX"
[ "$GO" = "1" ] || fail "Deal Owner can't see their Government SOR ($GO)"
[ "$GX" = "0" ] || fail "an employee on no Deal Team sees a Government SOR"

echo; echo "✔ REHEARSAL PASSED"
