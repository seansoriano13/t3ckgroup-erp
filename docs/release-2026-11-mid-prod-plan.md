# Release 2026-11 mid: staging to prod

The second November release: everything on `staging` after the 2026-11-12 release (specs #955, #956, #1000, #1013, #1031). It follows `docs/release-2026-11-prod-plan.md` and `docs/production-cutover-runbook.md`, with the fixes from a premortem run on 2026-11-16. Do the steps in order. Do not skip one because the last release went well.

## What ships

- **Web:** 101 commits. The new screens need the new database, so the database goes first.
- **Database:** 17 migrations, `20261201130000_960_…` to `20261211100000_1042_…`.
- **Edge function:** `odoo-costing-costs` changed (#961: it now reads Odoo's selling price). Prod edge functions deploy by hand only. **Without this step the Odoo SRP column and Final Acquire stay blank on every S0 Evaluation, with no error.**
- **Deletes prod data:** migration 967 drops the old per-line Canvass tables and empties `purchase_request_item_prices`. Migration 961 blanks `odoo_unit` on S0 Evaluation parts linked to a product (pulled again as the SRP on the next open, once the edge function is deployed).

## Checked on 2026-11-16 (read-only)

| Check | Result |
|---|---|
| Ledger (`pnpm db:ledger:check prod`) | 409 applied, exactly the 17 above pending, nothing missing or extra |
| Policy diff (`pnpm db:policy-diff`) | Every difference belongs to a pending migration (1001, 1002, 966, 967/969, 1042). After migrating it must be empty |
| Chat read rule on prod | One SELECT policy, "Enable read access for all users" (`true`), the one 1002 drops. No hidden second read policy |
| Old Canvasses (`docs/runbooks/canvass-per-request-prod-count.sql`) | **STOP: 1 Canvass, 2 Offers, no winner.** CNV_0001, made 2026-11-13 by a purchaser for a Requested Item: real work, not a test. A full copy is saved outside the repo. The user decides before the release |
| Rehearsal (`rehearsal/2026-11-16`) | See the PR that adds this file |

## Before the day

1. **The Canvass decision.** CNV_0001 is real work. The user says whether migration 967 may delete it, given the saved copy and that Purchasing re-enters it in the new grid. No OK, no release: 969 and later need 967's tables, so this batch cannot ship in part.
2. **Tell Purchasing,** in one line, that Canvasses made the old way are cleared and that one Canvass per Purchase Request replaces them.
3. **Rehearsal green** on the exact `staging` commit that will ship. A later commit to `staging` means a new rehearsal.
4. **Hold #1051.** It rewrites the October–November Release Notes on `main` in the same files `staging` replaced. Merging it first makes the release merge conflict on the live branch.
5. **What's New entry** for 1.11.0 is on `staging`, linking to Release Notes.

## Release evening, after 18:00 PHT

Keep steps 5 to 9 within about 30 minutes. Staff arrive about 08:00 PHT.

1. **Count script again.** It must show only CNV_0001. Anything new: stop and go back to the user.
2. **Note the live Vercel build** (the deployment to switch back to).
3. **Backup.** Push a `backup/**` branch to run `prod-backup.yml`. **Download the dump at once: the GitHub copy deletes itself after 1 day.** Check it holds the old Canvass tables: `pg_restore --list <dump> | grep sor_canvass`.
4. **Ledger check.** `pnpm db:ledger:check prod` lists exactly the 17 pending migrations. Confirm the ref against `.env.local`: prod is `epqmberwewztzbrkhhss`.
5. **migrate-prod** workflow, `confirm=apply`. Watch it. If it goes red, do not merge; fix forward the same night.
6. **Deploy the edge function:** `deploy-edge-functions.yml`, `environment=prod`, function `odoo-costing-costs`. Only after step 5: the new function calls a database function step 5 creates.
7. **Policy diff.** `pnpm db:policy-diff` prints nothing and exits 0.
8. **Chat privacy.** On prod, `select policyname, cmd, qual from pg_policies where tablename = 'committee_task_activity'` shows "Group Task chat follows the Group Task read rule" for SELECT and no `true` read rule. Then open a Group Task chat as someone not in it: it shows nothing.
9. **Merge `staging` into `main`.** This puts the new screens in front of all staff at once.
10. **Smoke test on prod:** the SOR register and an SOR window; My work, with its Waiting column filled (SOR history); Time Off & Overtime; one S0 Evaluation with Odoo-linked lines, where Odoo SRP and Final Acquire fill in; a Purchase Request's Canvass grid; the Beta tags and their hover.

## When to stop

- **Count script shows more than CNV_0001, or the user has not said yes:** no release.
- **migrate-prod fails partway:** do not merge the web. If prod is not fully migrated by 07:30 PHT, stop fixing live and choose between a fix and a restore (a restore wipes anything entered after the backup).
- **Two or more people hit errors on a core screen in the first hour after the merge** (SOR register, SOR window, My work, Time Off): switch Vercel back to the build from step 2 within 15 minutes. That restores the core screens; the Beta screens then need a forward fix, because the database has moved on.

## The day after

Check bug reports in the morning and at noon. The last release needed three small web fixes within 14 hours; plan the morning for fixes.

## Known and not in this release

- On prod and staging, `committee_task_activity` has "Authenticated users can update committee task activity" (UPDATE, `using (true)`): any signed-in employee can edit any Group Task chat message through the API. Migration 1002 closes reading only. It needs its own ticket and migration.
