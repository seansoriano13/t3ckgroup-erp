# Production cutover runbook — release/2026-09

Parent: #325, #377. This replaces `docs/production-deployment-gap.md` (deleted). The rehearsal (#336) and the real cutover (#338) follow this same document, step by step. If the rehearsal changes a step, change it here before the next run.

Everything runs from `release/2026-09` (frozen; see [release-2026-09.md](release-2026-09.md)).

The cutover runs in **two windows**, so the database change and the UI change never land together: a **database window** (Sep 29–30) with the old UI live throughout, and a **UI window** (Oct 1).

## Ground rules

- **Never rename a migration file to match a ledger row.** A file's timestamp is its identity. Renaming one a ledger has already recorded is exactly what creates the next orphan. Fix the ledger with the repair workflow instead.
- **Never execute the baseline** (`20260904000000_baseline_schema.sql`). It is only ever *marked* applied. Prod has everything it creates except `sales_opportunities.is_scratch`, which the rehearsal found missing. `20260904180000_prod_baseline_catchup.sql` adds it idempotently as the first migration `migrate-prod` applies.
- **Prod's migration ledger isn't proof that a migration is applied.** Rows have been marked applied without running, and rows exist that match no file. The policy diff (`pnpm db:policy-diff`) is the pass/fail gate, not the ledger.
- Every step has a check. Don't start the next step until the check passes. If a check fails, follow that window's stop-and-rollback note.
- No step deletes production data.
- Production project ref: `epqmberwewztzbrkhhss`. Staging: `fpjxdyowngpnovotbzqi`. Verify against `.env.local`, not `list_projects`.

## Before the windows

- [ ] #337 sign-offs done: department heads and HR told about SOR visibility, PITR status confirmed, Vercel owner agrees to the disconnect, and Operations has published fresh Government and Outright snapshots on staging and confirmed those are the versions to ship.
- [ ] #336 rehearsal passed twice in a row on fresh production clones.
- [ ] `hyper-action` decided on (#334).
- [ ] Vercel production's git integration is **disconnected** (Vercel → project → Settings → Git → Disconnect; the project owner does this). Vercel deploys every push to `main` live immediately, and the new UI must not go live before its window. **Check:** Settings → Git shows no connected repository.
- [ ] **REMOVE-BEFORE-PROD:** the SOR modal layout prototype is gone — `src/components/sor/modal/prototype/` deleted, nothing left tagged `REMOVE-BEFORE-PROD`, and the "SOR Layout Preview (Staging)" entry gone from `src/data/changelog.json` (the chosen layout, if any, rebuilt properly first). **Check:** `node scripts/check-no-prototypes.mjs` passes; CI's "No prototypes on main" fails otherwise.
- [ ] Staff heads-up sent Sep 30 (see [Staff heads-up](#staff-heads-up)).

## Database window — Sep 29–30 (old UI stays live)

### 1. Pre-cutover backup

```bash
pg_dump "$PROD_DB_URL" --format=custom --no-owner --file=prod-pre-cutover-$(date -u +%Y%m%dT%H%M%SZ).dump
```

**Check:** `pg_restore --list <file> | head` shows a clean table of contents, and the dump restores into a scratch database or branch. Keep the file off the repo. It is the restore point, whether or not PITR is on.

### 2. Repair the ledger

1. Actions → **Repair migration history** → project `prod`, version `20260914013100`, status `reverted`. That version is an orphan (`offset_leaves.approved_hours`, #198) and also the tip. While it stands, `db push` refuses everything, and every pending file sorting before it would be skipped. #328 forward-ports the column as `20260929010000_offset_leave_approved_hours.sql` (`add column if not exists`), so the re-apply is a no-op.
2. Actions → **Repair migration history** → project `prod`, version `20260904000000`, status `applied`. This is the baseline. It is marked applied, never run. Do it second: doing it first would leave the orphan tip in place.

**Check (hard gate):**

```bash
pnpm db:ledger:check prod
```

Zero orphans, zero out-of-order, exit 0.

### 3. Dispatch the production migration

Actions → **Apply migrations — production** → confirm `apply`. It brings in the pending migrations plus #380, #378 (`selector_everyone`) and #381 (`flow_always_edits`), and runs the ledger check as its first step.

**Check:** the workflow is green and `pnpm db:ledger:check prod` prints **Clean**. Then:

```bash
pnpm db:check-drift:prod
```

Spot-check `offset_leaves.approved_hours` (`select count(*) from offset_leaves where approved_hours is distinct from hours and approved_hours is not null` returns 7), the six `archive_quota` tables, and that `flow_access_settings.always_edits` exists.

### 4. Transfer Government and Outright

Prod already holds an earlier copy of both (same ids, from a mistaken run, no SORs). Outright is identical to staging: leave it. Government is stale (prod v4.1, 17 Stages; staging v4.12, 18 Stages): `--replace` deletes prod's copy and re-transfers staging's in the same transaction. It refuses if the Sale Type has any SORs.

Back up prod's Government first (`scripts/backup-flows.mjs`), dry run (rolled back), then apply:

```bash
node scripts/transfer-sales-flows.mjs --from staging --to prod --replace Government
node scripts/transfer-sales-flows.mjs --from staging --to prod --replace --apply Government
```

**Check:** Government 18 Stages, 17 edges (staging's latest). Outright stays 5 Stages, 4 edges. Zero `flow_access_settings` rows on Government, so it stays private to its Deal Team. The script refuses otherwise.

### 4b. Transfer Group Task Templates (#419)

All templates (archived too) and members. Employees remapped by **name**; a missing/ambiguous name or a same-named template on prod stops the run unless `--rename-clashes` is passed: those copy as "<name> (staging)" (prod already has "Delivery"; staging has two "PMS"). `--unarchive` lands every copy active so staff can decide which to keep. `--skip-existing` is the alternative that leaves prod's copy alone. Nothing is ever overwritten.

```bash
node scripts/transfer-group-task-templates.mjs --from staging --to prod
node scripts/transfer-group-task-templates.mjs --from staging --to prod --apply
```

**Check:** dry-run counts: 11 templates, 64 members, 0 archived, renamed "Delivery (staging)" and "PMS (staging)" (as of Sep 29); prod ends with 17 templates.

### 5. Legacy Pipeline backfill (#382)

```bash
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/cutover/legacy_pipeline_backfill.sql
```

Attaches every SOR with no Sale Type to Legacy Pipeline and sets Legacy Pipeline's Always sees and Always edits to Everyone. Idempotent; it only attaches and upserts.

**Check:** it prints `attached N SORs`, then:

```sql
select name from sale_types where id = 'f1d4e085-9a13-4c30-a2b7-b9f97f009608';  -- Legacy Pipeline
select count(*) from sales_opportunities where sale_type_id is null and coalesce(is_deleted,false) = false;  -- 0
select always_sees, always_edits from flow_access_settings fas join sales_flows f on f.id = fas.flow_id
 where f.sale_type_id = 'f1d4e085-9a13-4c30-a2b7-b9f97f009608';  -- both [{"type": "everyone"}]
```

### 6. Policy diff — the gate

```bash
pnpm db:policy-diff
```

Read-only. Compares every public policy's name, command and definition between production and staging.

**Check:** it prints nothing and exits 0. Each printed line is a policy that differs or exists on one side only. Stop and fix before going on.

**Known prod-only leftover (accepted, 2026-09-26):** `system_updates` (`Enable read for authenticated users`, `Enable write operations for authenticated users`) exists only on production and nothing drops it. Pass means those two `only on production` lines are the *only* output. #380 drops the audit-log and task-activity policies, so any other line, including those, is a stop. Flow-canvas write policies match staging after migration: anyone can edit the canvas, on purpose.

### 7. Old UI still works

On production, with the old UI, as an **Operations** user and an **Admin** user: register an SOR, move a Stage, edit the Product List.

**Check:** all three succeed for both users.

### 8. New UI on the prod copy (mirror)

On the prod copy (mirror), as an **Operations** user and a **Sales** user: open, edit and move a Legacy Pipeline SOR, and confirm a Government SOR stays private to its Deal Team.

**Check:** Legacy Pipeline SORs open, edit and move for both. The Government SOR is invisible to someone off its Deal Team.

### Stop and roll back — database window

The restore point is the step 1 dump. Restoring puts back schema, data and ledger exactly as they were. The old UI kept serving throughout, so staff see no change.

| Failed at | State | Do |
|---|---|---|
| 1 | Nothing changed | Fix and retry. |
| 2 (repair) | Ledger rows only | Undo with the same workflow (`applied` ↔ `reverted`), or restore the dump. |
| 3 (migrate) | Possibly partial: each file is its own transaction | Restore the dump. Don't push forward from a partial state. |
| 4 (transfer) | Its own transaction rolled back | Fix and re-run, or restore the dump. |
| 5 (backfill) | One `do` block, atomic | Fix and re-run (idempotent), or restore the dump. |
| 6–8 (checks) | Migrated but wrong | Restore the dump. |

```bash
pg_restore --clean --if-exists --no-owner --dbname "$PROD_DB_URL" prod-pre-cutover-<stamp>.dump
pnpm db:ledger:check prod   # should show the pre-cutover ledger again, orphan and all
```

If `pg_restore` itself fails and PITR is on (#337), restore to the timestamp noted before step 1 from the Supabase dashboard. Otherwise restore the dump into a fresh project and repoint. Stop and escalate before improvising.

## UI window — Oct 1

### 1. Re-run the backfill

Picks up SORs registered on the old UI since the database window.

```bash
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/cutover/legacy_pipeline_backfill.sql
pnpm db:policy-diff
```

**Check:** `select count(*) from sales_opportunities where sale_type_id is null and coalesce(is_deleted,false) = false` returns 0, and the policy diff prints nothing.

### 2. Redeploy the release's edge functions

Actions → **Deploy edge functions** (#333).

**Check:** the workflow is green.

### 3. Switch production to the new UI

1. Merge `release/2026-09` to `main` through a PR. Vercel is disconnected, so nothing deploys yet. **Check:** `main` is at the release commit.
2. Vercel → Settings → Git → reconnect the repository, production branch `main`.
3. Trigger a production deployment of `main` (Deployments → latest `main` build → Redeploy).

**Note the time: staff will see the new UI from this point.**

**Check:** the deployment is Ready, then the #338 smoke test: a Deal Owner opens a legacy SOR, registers a new SOR on Government, and HR approves an offset with edited hours.

### Stop and roll back — UI window

The database is already migrated and is not restored here.

| Failed at | Do |
|---|---|
| 1 (backfill) | Fix and re-run (idempotent). Don't switch. |
| 2 (edge functions) | Re-run the workflow. Don't switch. |
| 3 (switch) | Roll Vercel back to the previous production deployment (Deployments → Promote), or disconnect Vercel again. The old UI works on the migrated database (database window step 7). |

## Staff heads-up

Send Sep 30.

> Heads-up: the new SOR screen arrives Oct 1. Legacy projects look and work as before. New Government and Outright SORs are visible to their Deal Team.

## Rehearsal

`Cutover rehearsal` workflow (#336): push any `rehearsal/**` branch. It runs the database-window steps (dump, repairs, migrate, transfer, backfill twice) against fresh read-only dumps of prod on a CI runner (`scripts/rehearse-cutover.sh`), plus a `baseline-gap` job that diffs the baseline prod is marked as having against its live schema. Passed twice on 2026-09-18 (run 35315484079).
