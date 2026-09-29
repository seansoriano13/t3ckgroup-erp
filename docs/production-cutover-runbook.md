# Production cutover runbook — one big merge

Parent: #414 (was #325, #377). Flow and freeze rule: [release-2026-09.md](release-2026-09.md).

**Agent-run.** An agent (Claude Code) executes every step with its own tools: git/`gh`, Vercel CLI, Supabase CLI, `.env.local` DB URLs, the browser pane. The **operator** (Sean) is needed only where a step is marked **You**, and gives a "go" at each **⏸** before the agent continues. Everything else runs on its own as long as each check passes.

The cutover is **one maintenance window**. DB and UI go together. Staff are locked out by the build-time flag (#422) for the whole window.

Order: ⏸ lock → merge release → `main` → dump → repair check → ⏸ migrate → flows → backfill → edge functions → policy gate → smoke test → ⏸ 10pm go/no-go → ⏸ unlock.

## How the agent runs it

- **Checks gate everything.** Don't start the next step until the check passes.
- **Dry run first.** Every data step that has a dry run (rolled back) runs it first; apply only if its output matches the check.
- **Failures:**
  - **Infrastructure glitch** (rate limit, timeout, flaky runner): retry up to 2 times.
  - **Anything else** (data, schema, a wrong count): stop, post the output on #414, propose a fix, and wait for the operator. Never improvise on prod.
- **Progress log:** after each step, a comment on #414 with the step number, time (UTC+8), what ran and the check's output.
- **Commands** run from the repo root with `.env.local` providing `PROD_DB_URL` and `STAGING_DB_URL`. There are no local `pg_*` tools: `pg_dump`/`pg_restore`/`psql` run inside the local Supabase DB container (`supabase_db_t3ckgroup-erp-local`, Postgres 17), written below as `$PG` = `docker exec -i supabase_db_t3ckgroup-erp-local`.
- **Vercel** prod project is `t3ckgroup-erp`. The repo is normally linked to `t3ckgroup-erp-staging`: link prod for a Vercel step (`vercel link --yes --project t3ckgroup-erp`) and link back to staging after.

## Ground rules

- **Never rename a migration file to match a ledger row.** A file's timestamp is its identity. Fix the ledger with the repair workflow instead.
- **Never execute the baseline** (`20260904000000_baseline_schema.sql`). It is only ever *marked* applied.
- **Prod's migration ledger isn't proof a migration is applied.** The policy diff (step 9) is the pass/fail gate, alongside the ledger.
- **No improvised SQL on prod.** Only the reviewed files in the repo run against prod: migrations (through the workflow) and the cutover scripts named here (`scripts/*.mjs`, `supabase/scripts/cutover/*.sql`). Read-only `select`s for checks are fine.
- **No step deletes production data.** Restoring the dump (rollback) is the only exception, and needs the operator's explicit call.
- Production project ref: `epqmberwewztzbrkhhss`. Staging: `fpjxdyowngpnovotbzqi`. Verify against `.env.local`.
- **Fixes in the window:** code goes release branch → `main` → merged back to staging. DB changes go in as a migration file applied to both.

## Gates (before the window)

All must be true, or the window moves to the next evening:

- [x] **Freeze:** freeze commit noted on #414. **Agent** cuts `release/2026-09` from it at step 2.
- [x] **Rehearsal green** at or just before the freeze (see [Rehearsal](#rehearsal)). Changes after the last green run must be judged safe by the operator and listed on #414.
- [x] #337 sign-offs, #334 `hyper-action` decided.
- [x] **Flows published:** Ops published the Government / Outright snapshots to ship on staging (Government v5, Outright v2, 2026-09-29). Step 6 ships whatever is newer than prod.
- [x] **Vercel prod env:** `VITE_APP_ENV` unset. `VITE_MAINTENANCE=off` and `VITE_MAINTENANCE_ALLOW` (operator emails) exist in Production. **Agent check:** `vercel env pull` on the prod project shows exactly that.
- [x] **Prototype bundle check:** `node scripts/check-no-prototypes.mjs` passes on the freeze commit (CI's "No prototypes in the prod bundle" runs it). Sunset: delete `src/components/sor/modal/prototype/` by 2026-12-31 or bump the date on purpose ([ADR 0028](adr/0028-layout-prototypes-live-on-main-build-gated.md)).
- [x] **Release-notes entry:** the top entry of `src/data/changelog.json` is the curated prod entry (no `env`), per [release-notes-template.md](release-notes-template.md).
- [ ] **You:** staff notice sent (see [Staff notice](#staff-notice)).

## The window

### 1. Lock staff out ⏸

**⏸ Operator "go" to lock.**

**Agent:** link the prod Vercel project, then set `VITE_MAINTENANCE` to `on` in Production:

```bash
vercel env rm VITE_MAINTENANCE production --yes
printf on | vercel env add VITE_MAINTENANCE production
```

**Check:** `vercel env pull` (to a scratch file, deleted after) shows `VITE_MAINTENANCE="on"` and the allowlist. It's build-time: it only takes effect on the step 2 build.

### 2. Merge the release to `main`

**Agent:**
1. Cut `release/2026-09` from the freeze commit and push it.
2. Open a PR to `main`.
3. Wait for CI to go green, then merge it with a merge commit.

Vercel builds `main` locked.

**Check:**
- `git fetch && git diff <freeze-sha> origin/main` prints nothing: `main`'s files are exactly the freeze. The SHA differs, because the PR makes a merge commit.
- `vercel ls t3ckgroup-erp` shows the new production deployment **Ready**, created after step 1.
- The browser pane loads the prod URL.
- Deeper lock proof comes at step 10: the operator gets in because they're allowlisted.

### 3. Pre-cutover backup

**Agent:** dump the three schemas the cutover touches, then prove the dump restores:

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
$PG pg_dump "$PROD_DB_URL" -n public -n supabase_migrations -n archive_quota \
  --format=custom --no-owner --file=/tmp/prod-pre-cutover.dump
docker cp supabase_db_t3ckgroup-erp-local:/tmp/prod-pre-cutover.dump backups/prod-pre-cutover-$STAMP.dump   # backups/ is gitignored
$PG psql -U postgres -c "drop database if exists restore_check" -c "create database restore_check"
$PG pg_restore --no-owner -U postgres -d restore_check /tmp/prod-pre-cutover.dump
```

**Check:**
- The restore exits 0.
- `select count(*) from public.sales_opportunities` and `select count(*) from supabase_migrations.schema_migrations` match between `restore_check` and prod.
- Note the UTC time on #414; it's the point-in-time recovery (PITR) fallback.
- Then drop `restore_check`.

### 4. Ledger check (repairs already done)

Prod's ledger was repaired on 2026-09-23: the orphan `20260914013100` is gone, and the baseline `20260904000000` is marked applied.

**Agent:** `pnpm db:ledger:check prod --include-all`

**Check:** zero orphans, exit 0. Out-of-order pending files (`20260930*`) are expected; step 5 applies them.

Only if an orphan or a missing baseline shows up: run Actions → **Repair migration history** (`gh workflow run repair-migration-history.yml`), `20260914013100` → `reverted` first, then `20260904000000` → `applied`, and re-check.

### 5. Migrate ⏸

**Agent, before:** record counts for the step 5 check:
- the number of pending files, from the step 4 output;
- `select count(*) from offset_leaves where approved_hours is not null and approved_hours is distinct from hours`.

**⏸ Operator "go" to migrate.**

**Agent:**

```bash
gh workflow run migrate-prod.yml -f confirm=apply -f include_all=true
gh run watch <run-id> --exit-status
```

**Check:**
- The workflow is green.
- `pnpm db:ledger:check prod` prints **Clean**, with applied = the number of `supabase/migrations/*.sql` files.
- `pnpm db:check-drift:prod` passes.
- The `approved_hours` count equals the "before" value.
- The six `archive_quota` tables exist, and none are left in `public`.
- `flow_access_settings.always_edits` exists.

### 6. Flows and templates

#### 6a. Sales flows: ship whatever staging has newer

**Agent:** for each of Government and Outright, compare `max(flow_snapshots.version)` on staging vs prod. For each flow where staging is newer, run the dry run, then apply:

```bash
node scripts/transfer-sales-flows.mjs --from staging --to prod --replace <Name>          # dry run (rolled back)
node scripts/transfer-sales-flows.mjs --from staging --to prod --replace --apply <Name>
```

As of 2026-09-29 only Government is newer (staging v5, prod v4), and Outright is equal (v2): leave it. `--replace` refuses if the Sale Type has any SORs. Prod has none on either flow; if it refuses, stop and report.

**Check:** on prod each flow's Stage and edge counts and its latest snapshot version equal staging's, and Government has zero `flow_access_settings` rows.

#### 6b. Group Task Templates: done 2026-09-29

Already transferred with `--tag-all`. **Don't run the script**: even its dry run fails on duplicate ids.

**Check:**
- `select count(*) from group_task_templates` returns at least 17.
- Every staging template id exists on prod, with a name ending in "(staging…)".

#### 6c. Government's Project Delivery template

Run after 6a, because replacing Government brings back staging's pointer to "Delivery (staging)".

**Agent:**

```bash
node scripts/repoint-government-delivery-template.mjs --to prod            # dry run
node scripts/repoint-government-delivery-template.mjs --to prod --apply    # only if the dry run found something to change
```

**Check:** a re-run of the dry run prints "already points at DELIVERY".

### 7. Legacy Pipeline backfill (#382)

Attaches every SOR with no Sale Type to Legacy Pipeline, and sets its Always sees / Always edits to Everyone ([ADR 0021](adr/0021-stage-scoped-sor-visibility.md), 2026-09-25 amendment). Idempotent, one atomic `do` block.

**Agent:**

```bash
# dry run: same file, rolled back
{ echo begin; cat supabase/scripts/cutover/legacy_pipeline_backfill.sql; echo rollback; } | $PG psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -X
# apply
$PG psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -X < supabase/scripts/cutover/legacy_pipeline_backfill.sql
```

**Check:**
- The dry run prints `attached N SORs`, and N equals `select count(*) from sales_opportunities where sale_type_id is null and coalesce(is_deleted,false)=false` taken just before.
- After the apply, that count is 0.
- Legacy Pipeline's `flow_access_settings` has `always_sees` and `always_edits` both `[{"type": "everyone"}]`. Look it up by name: `join sale_types st on st.id = f.sale_type_id where st.name = 'Legacy Pipeline'`.

### 8. Redeploy edge functions

**Agent:**

```bash
gh workflow run deploy-edge-functions.yml -f environment=prod -f dry_run=true
gh workflow run deploy-edge-functions.yml -f environment=prod -f confirm=deploy
```

**Check:** the dry run lists the expected functions, and the deploy run is green.

### 9. Policy diff — the gate

**Agent:** `pnpm db:policy-diff`

**Check:** exit 0, and stdout is empty. The two accepted prod-only `system_updates` policies (accepted 2026-09-26) are built into the script (`scripts/lib/policyDiff.mjs`, `ACCEPTED`); it notes them on stderr and doesn't fail on them. Any stdout line is a stop.

### 10. Smoke test

**You:** log in once in the browser pane on the prod URL as an allowlisted operator. Getting in proves the allowlist works; the agent never types passwords.

**Agent**, in that session:
1. Open a Legacy SOR: the new Summary modal renders, and History loads.
2. Create a `ZZTEST` SOR, move it one Stage, then soft-delete it.
3. Open Flow Canvas → Government: the stages show the new phase colors.
4. Open Group Tasks: the templates list shows the "(staging)" ones.
5. What's New shows the v1.8.0 entry only.
6. Screenshot each and post them.

**Check:** no console errors, and:

```sql
select count(*) from sales_opportunities where project_title ilike 'ZZTEST%' and coalesce(is_deleted,false) = false;  -- 0
```

Deal Team privacy on Government / Outright SORs is proven in the rehearsal (a throwaway SOR on the clone), not on prod.

### 11. 10pm go/no-go ⏸

**Agent:** post a summary of steps 1–10 on #414.

**⏸ Operator decides.**
- **Go:** steps 1–10 green. Continue to step 12.
- **No-go:** [roll back before the unlock](#before-the-unlock-no-go-at-10pm-or-any-step-110).

### 12. Unlock ⏸

**⏸ Operator "go" to unlock.**

**Agent:** set `VITE_MAINTENANCE` to `off` in Vercel prod, then redeploy the current production deployment (`vercel redeploy <prod-deployment-url>`, which rebuilds `main`). Link back to staging.

**Check:**
- The new deployment is Ready.
- `vercel env pull` shows `off`.
- Note the time: **staff see the new UI from here**.

Then the post-cutover checks:

```bash
pnpm db:ledger:check prod    # Clean
pnpm db:policy-diff          # exit 0
```

Close #414 with the final log.

## Stop and roll back

Restore point: the step 3 dump (`backups/prod-pre-cutover-<stamp>.dump`), proven restorable at step 3. Fallback: PITR to the time noted at step 3, from the Supabase dashboard.

### Before the unlock (no-go at 10pm, or any step 1–10)

Staff are still locked out, so nothing is lost. **Never redeploy `main` during a rollback**: `main` holds the release.

| Failed at | State | Agent does |
|---|---|---|
| 1–2 (lock, merge) | No DB change | Fix and retry. If a deploy went out **unlocked**, promote the previous deployment immediately. |
| 3 (dump) | Nothing changed | Fix and retry. Never migrate without a dump that restored. |
| 4 (ledger) | Ledger rows only | Undo with the same repair workflow (`applied` ↔ `reverted`). |
| 5 (migrate) | Possibly partial: each file is its own transaction | Full rollback (below). Don't push forward from a partial state. |
| 6–7 (flows, backfill) | Each run is one transaction; a failure rolls itself back | Fix and re-run, or a full rollback. |
| 8 (edge functions) | Functions only | Re-run the workflow. |
| 9–10 (gate, smoke) | Migrated but wrong | Fix with a migration (applied to both) if it fits before 10pm, else no-go and a full rollback. |

**Full rollback** (operator's call):
1. **Restore the DB:**

   ```bash
   docker cp backups/prod-pre-cutover-<stamp>.dump supabase_db_t3ckgroup-erp-local:/tmp/prod-pre-cutover.dump
   $PG pg_restore --clean --if-exists --no-owner -d "$PROD_DB_URL" /tmp/prod-pre-cutover.dump
   pnpm db:ledger:check prod   # the pre-cutover ledger again: the step 4 pending count, no orphans
   ```

   If `pg_restore` fails: PITR to the step 3 time. Stop and escalate before improvising.
2. **Put the old app back:** in the prod project, `vercel promote <previous-production-deployment-url>`. That deploy was built before the lock, so it's **unlocked**, and staff are back on the old UI.
3. **Revert `main`:** open a PR reverting the release merge, and merge it once green. Its build is locked (the env is still `on`), but prod keeps serving the promoted deploy, so staff aren't affected.
4. **Clear the flag:** set `VITE_MAINTENANCE=off`. Don't redeploy.
5. **Post on #414** what failed and the state now.

### After the unlock (staff already writing)

Restoring the dump would **erase everything staff wrote since the unlock**.

1. **Re-lock:** set `VITE_MAINTENANCE=on`, then redeploy the current production deployment. Staff are out, and nothing more gets written.
2. **Default: fix forward.** Code goes release branch → `main`; DB changes go in as a migration applied to both. Then unlock again (step 12).
3. **Restore only on the operator's explicit call**, when the problem is worse than losing the post-unlock writes (e.g. data being corrupted). First post on #414 that writes since `<unlock time>` will be lost. Then run the full rollback above.

## Staff notice

**You**, by chat, before the window:

> Heads-up: the system is down tonight from 7pm for an upgrade. The new SOR screen is live when it comes back. Legacy projects look and work as before. New Government and Outright SORs are visible to their Deal Team.

## Rehearsal

`Cutover rehearsal` workflow (#336): push any `rehearsal/**` branch cut from the freeze commit. `scripts/rehearse-cutover.sh` runs steps 3–7 plus the RLS checks on a CI runner against a fresh read-only dump of prod. Its step labels match this runbook. A `baseline-gap` job runs alongside.

The RLS checks prove three things:
- a Super Admin sees every SOR;
- Legacy Pipeline is open to Everyone;
- Deal Team privacy on a throwaway Government SOR created on the clone: its owner sees it, and an employee outside its Deal Team doesn't.

**Last green run:** 2026-09-29, run 36547054665 at `de7f5d62`. Changes since, judged safe without a rerun (#414): the stage-color migration `dd4d93f9`, and the runbook and rehearsal-script edits.
