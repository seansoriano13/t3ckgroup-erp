# Production cutover runbook — release/2026-09

Parent: #325. This replaces `docs/production-deployment-gap.md` (deleted). The rehearsal (#336) and the real cutover (#338) follow this same document, step by step. If the rehearsal changes a step, change it here before the next run.

Everything runs from `release/2026-09` (frozen; see [release-2026-09.md](release-2026-09.md)).

## Ground rules

- **Never rename a migration file to match a ledger row.** A file's timestamp is its identity. Renaming one a ledger has already recorded is exactly what creates the next orphan. Fix the ledger with the repair workflow instead.
- **Never execute the baseline** (`20260904000000_baseline_schema.sql`). Production already has every object it creates. It is only ever *marked* applied.
- Every step has a check. Don't start the next step until the check passes. If a check fails, go to [Rollback](#rollback).
- Production project ref: `epqmberwewztzbrkhhss`. Staging: `fpjxdyowngpnovotbzqi`. Verify against `.env.local`, not `list_projects`.

## Before the window

- [ ] #337 sign-offs done: department heads and HR told about SOR visibility, PITR status confirmed, Vercel owner agrees to the disconnect, and Operations has published fresh Government and Outright snapshots on staging and confirmed those are the versions to ship.
- [ ] #336 rehearsal passed twice in a row on fresh production clones.
- [ ] Edge functions deployed to prod with **Deploy edge functions** (#333), and `hyper-action` has been decided on (#334).

## Cutover order

### 1. Disconnect Vercel production's git integration

Vercel deploys every push to `main` live immediately. The web app for this release must not go live before its schema does.

1. Vercel → project → Settings → Git → **Disconnect** the production git connection. (The project owner does this; see #337.)
2. Note the time. The window is open from here until step 10.

**Check:** Settings → Git shows no connected repository.

### 2. `pg_dump` production

```bash
pg_dump "$PROD_DB_URL" --format=custom --no-owner --file=prod-pre-cutover-$(date -u +%Y%m%dT%H%M%SZ).dump
```

**Check:** confirm it restores. Run `pg_restore --list <file> | head` and look for a clean table of contents, then restore it into a scratch database or branch. Keep the file off the repo. It is the restore point, whether or not PITR is on.

### 3. Repair 1: revert the orphan `20260914013100`

Actions → **Repair migration history** → project `prod`, version `20260914013100`, status `reverted`.

**Why first, and why it matters:** production's ledger is `20260904100000`, `20260904120000`, `20260904173500`, `20260914013100`. The last row is an orphan, and it's also the tip. While it stands, `db push` refuses everything (orphan), and even after that is worked around, every pending file that sorts before `20260914013100` (38 of them) would be skipped while the newer ones apply. The SOR access rewrite would land on a schema without its prerequisites. Reverting it drops the tip to `20260904173500`, which brings every pending migration except the baseline back into range.

**How the orphan came about:** it's `offset_leaves.approved_hours` from main (#198). It was written as sequential `0071_…` while the repo was switching to timestamped filenames (ADR 0007), and the push recorded it under a generated timestamp that matches no file on any branch. The column itself is real and stays. #328 forward-ports it as `20260929010000_offset_leave_approved_hours.sql` with `add column if not exists`, so the re-apply is a no-op on production.

**Check:** `pnpm db:ledger:check prod` no longer lists `20260914013100` as an orphan. It will still show the baseline as out of order.

### 4. Repair 2: mark the baseline `20260904000000` applied

Actions → **Repair migration history** → project `prod`, version `20260904000000`, status `applied`.

**Why second:** the baseline sorts before every ledger row, so it's out of order until the ledger records it. It must be marked applied, never run (see the ground rules). Doing it before step 3 would leave the orphan tip in place, and the out-of-order set would still be the 37 real migrations.

**Check (hard gate):**

```bash
pnpm db:ledger:check prod
```

It must print zero orphans and zero out-of-order, and exit 0. `migrate-prod` runs the same check as its first step (#332) and stops if it fails.

### 5. `migrate-prod`

Actions → **Apply migrations — production** → confirm `apply`.

**Check:** the workflow is green, the ledger-check step passes, and `pnpm db:ledger:check prod` prints **Clean**.

### 6. Verify the schema

```bash
pnpm db:check-drift:prod
```

Then spot-check:

- `offset_leaves.approved_hours` exists and still holds its values. `select count(*) from offset_leaves where approved_hours is distinct from hours and approved_hours is not null` should return 7.
- `archive_quota` has six tables whose row counts match the numbers recorded in `20260909105900_archive_quota_tables.sql` (sales_activity_logs 4,241, sales_activities 1,895, sales_revenue_logs 102, sales_weekly_plans 62, sales_quotas 24, sales_quota_logs 20). The `public.` originals are gone.
- `sor_stage_visits` and `sor_stage_participants` read policies use `sor_access_level` (#327).

**Check:** no drift beyond what this release intends, and every spot-check matches.

### 7. Transfer Government and Outright

Dry run first. It runs everything in one transaction and rolls back:

```bash
node scripts/transfer-sales-flows.mjs --from staging --to prod Government Outright
```

Read the counts, then apply:

```bash
node scripts/transfer-sales-flows.mjs --from staging --to prod --apply Government Outright
```

**Check:** the reported Stage and edge counts match staging (Government 17 Stages, 16 edges; Outright 5 Stages, 4 edges), along with the action, condition, field and follow-up counts. Both flows end with zero `flow_access_settings` rows, and the script refuses otherwise. A failure writes nothing.

### 8. Legacy Pipeline: rename and backfill

```bash
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/cutover/legacy_pipeline_backfill.sql
```

**Check:** it prints `attached N SORs` (N = the non-deleted SORs with no Sale Type: 251 on 2026-09-18), each placed on the Legacy Pipeline Stage named after its current status. Then:

```sql
select name from sale_types where id = 'f1d4e085-9a13-4c30-a2b7-b9f97f009608';  -- Legacy Pipeline
select count(*) from sales_opportunities where sale_type_id is null and coalesce(is_deleted,false) = false;  -- 0
```

The script is idempotent, so running it again is safe.

### 9. Merge `release/2026-09` to `main`

Merge through a PR. Vercel is disconnected, so nothing deploys yet.

**Check:** `main` is at the release commit.

### 10. Reconnect Vercel

1. Vercel → Settings → Git → reconnect the repository, production branch `main`.
2. Trigger a production deployment of `main` (Deployments → latest `main` build → Redeploy).
3. Note the time. The window closes here.

**Check:** the production deployment is Ready, then run the smoke test from #338: a Deal Owner opens a legacy SOR, registers a new SOR on Government, and HR approves an offset with edited hours.

## Rollback

The restore point is the step 2 `pg_dump`. Restoring it puts back the schema, data and migration ledger exactly as they were. Vercel is still disconnected, so the old web app keeps serving throughout.

| Failed at | State | Do |
|---|---|---|
| 1–2 | Nothing changed | Fix and retry. Reconnect Vercel if you're abandoning. |
| 3–4 (repair) | Ledger rows only, no schema change | Undo the repair with the same workflow (`applied` ↔ `reverted`), or restore the dump. Reconnect Vercel. |
| 5 (`migrate-prod`) | Possibly partial: `db push` applies each file in its own transaction, so a failure leaves earlier files applied | Restore the dump (below). Don't try to push forward from a partial state. Reconnect Vercel. |
| 6 (verify) | Migrated but wrong | Restore the dump. Reconnect Vercel. |
| 7 (transfer) | The script's own transaction rolled back, so nothing was written | Fix the cause and re-run. If you're abandoning, restore the dump. |
| 8 (backfill) | One `do` block, atomic | Fix and re-run (idempotent), or restore the dump. |
| 9–10 | App deploy problem, database is fine | Roll Vercel back to the previous production deployment (Deployments → Promote). Don't restore the database. |

Restore:

```bash
pg_restore --clean --if-exists --no-owner --dbname "$PROD_DB_URL" prod-pre-cutover-<stamp>.dump
pnpm db:ledger:check prod   # should show the pre-cutover ledger again, orphan and all
```

If `pg_restore` itself fails, and PITR is on (#337), restore to the timestamp noted in step 1 from the Supabase dashboard. If it isn't on, restore the dump into a fresh project and repoint. Stop and escalate before improvising.
