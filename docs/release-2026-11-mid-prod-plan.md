# Release 2026-11 mid: staging to prod

The second November release: everything on `staging` after the 2026-11-12 release (specs #955, #956, #1000, #1013, #1031), plus the fixes found while preparing it. It follows `docs/release-2026-11-prod-plan.md` and `docs/production-cutover-runbook.md`, with the fixes from a premortem run on 2026-11-16. Do the steps in order. Do not skip one because the last release went well.

## What ships

- **Web:** about 100 commits. The new screens need the new database, so the database goes first.
- **Database:** 19 migrations.
  - `20261216080000_676_status_words_on_prod`, right after the 17. **Prod never got the Requested Item status words (#676).** Its ledger holds `20261104120000` for `group_task_reopen`, applied there before that file was renumbered, so `requested_item_new_status_words` (now at that version) counted as applied and never ran. Prod's lines still say `requested`, `canvassing`, `ordered`, with the old CHECK, while the web app has used the new words since 2026-11-12. This migration makes #676's change, and changes nothing where #676 ran.
  - The 17 from staging, `20261201130000_960_…` to `20261211100000_1042_…`.
  - `20261216090000_unsend_uses_employee_id`: unsend compares the author with the employee id. It was on the staging database already, applied by hand.
- **Edge function:** `odoo-costing-costs` changed (#961: it now reads Odoo's selling price). Prod edge functions deploy by hand only. **Without this step the Odoo SRP column and Final Acquire stay blank on every S0 Evaluation, with no error.**
- **Deletes prod data:** migration 967 drops the old per-line Canvass tables and empties `purchase_request_item_prices`. Migration 961 blanks `odoo_unit` on S0 Evaluation parts linked to a product (pulled again as the SRP on the next open, once the edge function is deployed).

## Checked on 2026-11-16 (read-only on prod)

| Check | Result |
|---|---|
| Ledger (`pnpm db:ledger:check prod`) | 409 applied, the 19 above pending. It now also compares names: one known misnamed row, `20261104120000` (see above) |
| Function diff (`pnpm db:function-diff`, new) | Before migrating, every difference belongs to a pending migration, except the three status functions and `unsend_chat_message`, which the new migrations fix. After migrating it must be empty |
| Policy diff (`pnpm db:policy-diff`) | Every difference belongs to a pending migration (1001, 1002, 966, 967/969, 1042). After migrating it must be empty |
| Group Task chat on prod | One SELECT policy, "Enable read access for all users" (`true`), the one 1002 drops. The update guard from #658 (`trg_committee_task_activity_update_guard`) is live, so nobody can change another person's message directly |
| Old Canvasses (`docs/runbooks/canvass-per-request-prod-count.sql`) | **1 Canvass, 2 Offers, no winner:** CNV_0001, made 2026-11-13 by a purchaser for a Requested Item. Real work, so it is **carried over**, not lost (below). A copy is saved outside the repo |
| Carry-over (`scripts/carry-over-old-canvass.mjs`) | Tested on staging with prod's saved rows: CNV_0001 keeps its number, both suppliers, brands, descriptions, links, remarks and prices. A second run adds nothing |
| Rehearsal | `rehearsal/2026-11-16` stopped while loading the prod copy (prod has had `btree_gist` since migration 619; fixed). `rehearsal/2026-11-16-b` passed, before the status-words fix. `rehearsal/2026-11-16-c` (all 19, plus the function diff): **passed, both runs.** Ledger 409 → 428 applied; every function body matches staging, bar the accepted prod-only `rls_auto_enable()`. One note, not a failure: 14 SORs on prod have no Sale Type, and the release leaves them as they are |

## Before the day

1. **Merge #1052 into `staging`.** It carries the status-words migration, the unsend migration, the scripts and the What's New entry. `migrate-staging` applies the two migrations to staging (both change nothing there).
2. **Tell Purchasing** (message below).
3. **Rehearsal green** on the migrations that ship. A later commit to `staging` that adds or changes a migration means a new rehearsal (push a new `rehearsal/**` branch).
4. **#1051 stays a draft.** It rewrites the October–November Release Notes on `main` in the same files `staging` replaced. Close it after the release.

Message to Purchasing:

> Heads-up: tonight's ERP update changes Canvass. There is now one Canvass per Purchase Request, in a single grid. Canvasses made the old way move into the new grid automatically, with the same CNV number, suppliers and prices. Please check yours tomorrow and tell me if anything looks off.

## Release evening, after 18:00 PHT

Keep steps 6 to 12 within about 30 minutes. Staff arrive about 08:00 PHT. Prod is `epqmberwewztzbrkhhss`: check it against `.env.local` before any step that writes.

1. **Count script.** It must show only CNV_0001. Anything new: stop and go back to the user.
2. **Save the old Canvass rows**, read-only, to a new file outside the repo:
   `node scripts/carry-over-old-canvass.mjs prod "C:/Users/user/Documents/t3ckgroup-release-backups/prod-old-canvass-<date>-release.json" --save`
3. **Note the live Vercel build** (the deployment to switch back to).
4. **Backup.** Push a `backup/**` branch to run `prod-backup.yml`. **Download the dump at once: the GitHub copy deletes itself after 1 day.** Check it holds the five old Canvass tables: `pg_restore --list <dump> | grep sor_canvass`.
5. **Ledger check.** `pnpm db:ledger:check prod` lists the 19 pending migrations and the one known misnamed row, and passes.
6. **migrate-prod**, from `staging` (main does not have the migrations yet): `gh workflow run migrate-prod.yml --ref staging -f confirm=apply`. Watch it. If it goes red, do not merge; fix forward the same night.
7. **Carry the old Canvass over.** Dry run first, then apply, with the file from step 2:
   `node scripts/carry-over-old-canvass.mjs prod "<file from step 2>"`, read the output, then the same with `--apply`. It must say `CNV_0001 -> CNV_0001: 2 supplier(s), 2 quote(s)`. The line moves from Not checked to Still canvassing, and the Purchase Request's chat gets that status note, as if it had been entered in the new grid. Do this before step 11: until the web merge nobody can make a new Canvass.
8. **Deploy the edge function**, also from `staging` (main still has the old one): `gh workflow run deploy-edge-functions.yml --ref staging -f environment=prod -f functions=odoo-costing-costs -f confirm=deploy`. Only after step 6: the new function calls a database function step 6 creates.
9. **Policy diff and function diff.** `pnpm db:policy-diff` and `pnpm db:function-diff` both print nothing and exit 0.
10. **Chat privacy.** On prod, `select policyname, cmd, qual from pg_policies where tablename = 'committee_task_activity'` shows "Group Task chat follows the Group Task read rule" for SELECT and no `true` read rule. Then open a Group Task chat as someone not in it: it shows nothing.
11. **Merge `staging` into `main`.** This puts the new screens in front of all staff at once.
12. **Smoke test on prod:** the SOR register and an SOR window; My work, with its Waiting column filled (SOR history); Time Off & Overtime; one S0 Evaluation with Odoo-linked lines, where Odoo SRP and Final Acquire fill in; a Purchase Request's lines showing the new status words (Not checked, Still canvassing); CNV_0001's grid with both suppliers and their prices; unsend on a fresh chat message; the Beta tags and their hover.

## When to stop

- **Count script shows more than CNV_0001:** stop. Save it (step 2) and go back to the user; the carry-over stops by itself on a winner or a "No other supplier" note.
- **migrate-prod fails partway:** do not merge the web. If prod is not fully migrated by 07:30 PHT, stop fixing live and choose between a fix and a restore (a restore wipes anything entered after the backup).
- **The carry-over refuses:** nothing was added. The release can go on; re-enter CNV_0001 in the grid by hand from the saved file.
- **Two or more people hit errors on a core screen in the first hour after the merge** (SOR register, SOR window, My work, Time Off): switch Vercel back to the build from step 3 within 15 minutes. That restores the core screens; the Beta screens then need a forward fix, because the database has moved on.

## The day after

- Check bug reports in the morning and at noon. The last release needed three small web fixes within 14 hours; plan the morning for fixes.
- **Change the prod database password.** It was printed into a session log on 2026-11-16. Reset it in the Supabase dashboard (project `epqmberwewztzbrkhhss`, Project Settings, Database), then run `node scripts/rotate-db-password.mjs prod` and type the new password. It checks the password signs in, then updates the five settings files on this PC and the GitHub secrets `PROD_DB_PASSWORD` and `PROD_DB_URL`. Then run `pnpm db:ledger:check prod` to confirm. After the release, not before, so release night does not depend on it.

## Known and not in this release

- `committee_task_activity` keeps "Authenticated users can update committee task activity" (UPDATE, `true`) and an INSERT policy with check `true`, on prod and staging. The #658 guard blocks direct changes to chat messages (COMMENT rows), so messages are safe. Through the API, a signed-in employee could still edit a Group Task's automatic activity entries, or post into a Group Task they cannot see. Low risk, needs its own ticket.
