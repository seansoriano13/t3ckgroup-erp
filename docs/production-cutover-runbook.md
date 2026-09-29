# Production cutover runbook — one big merge

Parent: #414 (was #325, #377). Replaces `docs/production-deployment-gap.md` (deleted). The rehearsal (#336) and the real cutover (#338) follow this document, step by step. If the rehearsal changes a step, change it here before the next run.

Flow and freeze rule: [release-2026-09.md](release-2026-09.md). Source of the release is the **freeze commit** cut from staging, on a release branch that is PR'd to `main`. No step treats a long-lived `release/2026-09` as the source.

The cutover is **one maintenance window**. DB and UI go together. Staff are locked out by the build-time flag (#422) for the whole window.

Order: set `VITE_MAINTENANCE` → merge release → `main` (Vercel stays connected and builds locked) → dump → migrate (`include_all`, #423) → transfers → backfill → edge functions → smoke test → unlock.

## Ground rules

- **Never rename a migration file to match a ledger row.** A file's timestamp is its identity. Fix the ledger with the repair workflow instead.
- **Never execute the baseline** (`20260904000000_baseline_schema.sql`). It is only ever *marked* applied. `20260904180000_prod_baseline_catchup.sql` adds the one thing prod lacks (`sales_opportunities.is_scratch`) idempotently.
- **Prod's migration ledger isn't proof a migration is applied.** The policy diff (`pnpm db:policy-diff`) is the pass/fail gate, not the ledger.
- Every step has a check. Don't start the next step until it passes. On failure, see [Stop and roll back](#stop-and-roll-back).
- No step deletes production data.
- Production project ref: `epqmberwewztzbrkhhss`. Staging: `fpjxdyowngpnovotbzqi`. Verify against `.env.local`, not `list_projects`.
- **Fixes in the window:** code goes release branch → prod → merge back to staging. DB changes go in as a migration file applied to both, never raw SQL.

## Gates (before 7pm)

All must be true, or the window moves to the next evening:

- [ ] **Freeze:** release branch cut from staging at the freeze commit; SHA noted in the ticket.
- [ ] **Rehearsal green** on a fresh prod clone, at the freeze commit, with **all 103 migrations applied** (see [Rehearsal](#rehearsal)).
- [ ] #337 sign-offs done: department heads and HR told about SOR visibility, PITR status confirmed, and Operations has published fresh Government and Outright snapshots on staging and confirmed those are the versions to ship.
- [ ] `hyper-action` decided on (#334).
- [ ] **Prototype bundle check:** the SOR modal layout prototype is build-gated, not deleted ([ADR 0028](adr/0028-layout-prototypes-live-on-main-build-gated.md)). Vercel prod must NOT set `VITE_APP_ENV` to `staging`/`local`. **Check:** `node scripts/check-no-prototypes.mjs` passes on the freeze commit; CI's "No prototypes in the prod bundle" runs it. Sunset: delete `src/components/sor/modal/prototype/` by 2026-12-31 or bump the date on purpose.
- [ ] **Release-notes entry:** curated prod entry added on top of `src/data/changelog.json`, written per [release-notes-template.md](release-notes-template.md). What's New shows only the top entry. **Check:** it is the top entry and is not staging-only.
- [ ] **Staff notice sent by chat** (see [Staff notice](#staff-notice)).

## The window (7pm)

### 1. Lock staff out

Vercel prod env: `VITE_MAINTENANCE=on`, `VITE_MAINTENANCE_ALLOW=<operator emails, comma-separated>`. Vercel stays connected to git.

**Check:** the setting is saved. The lock is a build-time flag, so it only takes effect on the next build (step 2). Confirm in step 2 that the build is locked.

### 2. Merge the release to `main`

PR the release branch → `main` and merge. Vercel builds `main` **locked**.

**Check:** `main` is at the freeze commit (plus any window fixes). The deployment is Ready, and as a non-allowlisted user you see the maintenance screen; as an allowlisted operator you get in.

### 3. Pre-cutover backup

```bash
pg_dump "$PROD_DB_URL" --format=custom --no-owner --file=prod-pre-cutover-$(date -u +%Y%m%dT%H%M%SZ).dump
```

**Check:** `pg_restore --list <file> | head` shows a clean table of contents, and the dump restores into a scratch database or branch. Keep the file off the repo. It is the restore point. Note the time (for PITR).

### 4. Repair the ledger

1. Actions → **Repair migration history** → project `prod`, version `20260914013100`, status `reverted`. That version is an orphan (`offset_leaves.approved_hours`, #198) and the tip. While it stands, `db push` refuses everything. #328 forward-ports the column as `20260929010000_offset_leave_approved_hours.sql` (`add column if not exists`).
2. Actions → **Repair migration history** → project `prod`, version `20260904000000`, status `applied` (the baseline; marked, never run). Do it second.

**Check (hard gate):** `pnpm db:ledger:check prod` → zero orphans, zero out-of-order, exit 0.

### 5. Migrate

Actions → **Apply migrations — production** → confirm `apply`, tick **include_all** (#423: pushes with `--include-all` so out-of-order files apply). Runs the ledger check as its first step.

**Check:** the workflow is green and `pnpm db:ledger:check prod` prints **Clean**. Then `pnpm db:check-drift:prod`. Spot-check `offset_leaves.approved_hours` (`select count(*) from offset_leaves where approved_hours is distinct from hours and approved_hours is not null` returns 7), the six `archive_quota` tables, and that `flow_access_settings.always_edits` exists.

### 6. Transfers

Every transfer is: dry run → read the output → apply → check.

#### 6a. Government and Outright flows

Prod already holds an earlier copy of both (same ids, no SORs). Outright is identical to staging: leave it. Government is stale (prod v4.1, 17 Stages; staging v4.12, 18 Stages): `--replace` deletes prod's copy and re-transfers staging's in one transaction. It refuses if the Sale Type has any SORs. Back up prod's Government first (`scripts/backup-flows.mjs`).

```bash
node scripts/transfer-sales-flows.mjs --from staging --to prod --replace Government          # dry run (rolled back)
node scripts/transfer-sales-flows.mjs --from staging --to prod --replace --apply Government
```

**Check:** Government 18 Stages, 17 edges. Outright stays 5 Stages, 4 edges. Zero `flow_access_settings` rows on Government (private to its Deal Team); the script refuses otherwise.

#### 6b. Group Task Templates (#419)

All templates (archived too) and members. Employees remapped by **name**; a missing/ambiguous name or a same-named template on prod stops the run unless a naming option is passed. `--tag-all` copies every template as "<name> (staging)" ("(staging 2)" for repeats). Alternatives: `--rename-clashes`, `--skip-existing`. Nothing is overwritten.

```bash
node scripts/transfer-group-task-templates.mjs --from staging --to prod            # dry run
node scripts/transfer-group-task-templates.mjs --from staging --to prod --apply
```

**Check:** dry-run counts: 11 templates (2 archived), 64 members, all "... (staging)" (as of Sep 29); prod ends with 17 templates.

#### 6c. Repoint Government's Project Delivery template (#419)

Government's Project Delivery action arrives pointing at "Delivery (staging)". Point it (and the flow snapshot) at prod's "DELIVERY". Run after 6b; refuses if the templates aren't there.

```bash
node scripts/repoint-government-delivery-template.mjs --to prod            # dry run
node scripts/repoint-government-delivery-template.mjs --to prod --apply
```

**Check:** "Project Delivery: Delivery (staging) → DELIVERY (action + 1 snapshot(s))". Re-running says "already points at DELIVERY".

### 7. Legacy Pipeline backfill (#382)

```bash
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/cutover/legacy_pipeline_backfill.sql
```

Attaches every SOR with no Sale Type to Legacy Pipeline and sets its Always sees / Always edits to Everyone. Idempotent.

**Check:** it prints `attached N SORs`, then:

```sql
select count(*) from sales_opportunities where sale_type_id is null and coalesce(is_deleted,false) = false;  -- 0
select always_sees, always_edits from flow_access_settings fas join sales_flows f on f.id = fas.flow_id
 where f.sale_type_id = 'f1d4e085-9a13-4c30-a2b7-b9f97f009608';  -- both [{"type": "everyone"}]
```

### 8. Redeploy edge functions

Actions → **Deploy edge functions** (#333).

**Check:** the workflow is green.

### 9. Policy diff — the gate

```bash
pnpm db:policy-diff
```

**Check:** prints nothing and exits 0. Each line is a policy that differs or exists on one side only. Stop and fix before going on.

**Known prod-only leftover (accepted, 2026-09-26):** `system_updates` (`Enable read for authenticated users`, `Enable write operations for authenticated users`) exists only on production. Pass means those two `only on production` lines are the *only* output. Any other line is a stop. Flow-canvas write policies match staging: anyone can edit the canvas, on purpose.

### 10. Smoke test (as the operator, allowlisted)

On prod, in the new UI:

1. Create a `ZZTEST` SOR.
2. Move one Stage.
3. Soft-delete it.
4. **Check none are left:**

```sql
select count(*) from sales_opportunities where name ilike 'ZZTEST%' and coalesce(is_deleted,false) = false;  -- 0
```

Also open a legacy SOR and confirm a Government SOR stays private to its Deal Team.

### 11. 10pm go/no-go

Go = steps 1–10 green. **Red = no-go:** restore the dump, promote the previous Vercel deploy, unlock (see below).

### 12. Unlock

Set `VITE_MAINTENANCE=off` (or remove it) in Vercel prod and redeploy `main`.

**Check:** a non-allowlisted staff user gets in. **Note the time: staff see the new UI from here.** Then the post-cutover checks:

```bash
pnpm db:ledger:check prod    # Clean
pnpm db:policy-diff          # clean (only the accepted system_updates lines)
```

## Stop and roll back

Restore point is the step 3 dump. Restoring puts back schema, data and ledger exactly as they were.

| Failed at | State | Do |
|---|---|---|
| 1–2 (lock, merge) | No DB change | Fix and retry. Keep staff locked. |
| 3 (dump) | Nothing changed | Fix and retry. Don't migrate without a dump. |
| 4 (repair) | Ledger rows only | Undo with the same workflow (`applied` ↔ `reverted`), or restore the dump. |
| 5 (migrate) | Possibly partial: each file is its own transaction | Restore the dump. Don't push forward from a partial state. |
| 6 (transfer) | Its own transaction rolled back | Fix and re-run, or restore the dump. |
| 7 (backfill) | One `do` block, atomic | Fix and re-run (idempotent), or restore the dump. |
| 8 (edge functions) | Functions only | Re-run the workflow. |
| 9–10 (checks, smoke) | Migrated but wrong | Fix with a migration (applied to both) if small; else restore the dump. |
| 11 (10pm red) | — | Restore the dump, promote the previous Vercel deploy, unlock. |

```bash
pg_restore --clean --if-exists --no-owner --dbname "$PROD_DB_URL" prod-pre-cutover-<stamp>.dump
pnpm db:ledger:check prod   # should show the pre-cutover ledger again, orphan and all
```

Then Vercel → Deployments → previous production deploy → **Promote**, and unlock (step 12). If `pg_restore` itself fails and PITR is on (#337), restore to the timestamp noted before step 3 from the Supabase dashboard. Otherwise restore the dump into a fresh project and repoint. Stop and escalate before improvising.

## Staff notice

Send by chat, before the window.

> Heads-up: the system is down tonight from 7pm for an upgrade. The new SOR screen is live when it comes back. Legacy projects look and work as before. New Government and Outright SORs are visible to their Deal Team.

## Rehearsal

`Cutover rehearsal` workflow (#336): push any `rehearsal/**` branch cut from the freeze commit. It runs the DB steps (dump, repairs, migrate with `--include-all`, transfers incl. `--include-all` and GTT transfer per #423, backfill twice) against fresh read-only dumps of prod on a CI runner (`scripts/rehearse-cutover.sh`), plus a `baseline-gap` job.

**Pre-window gate:** green on a fresh prod clone with all 103 migrations applied. Passed twice on 2026-09-18 (run 35315484079) against the earlier plan; re-run at the freeze commit.
