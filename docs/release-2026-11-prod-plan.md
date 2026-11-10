# Release 2026-11: staging to prod, purchasing as Beta

Spec agreed in a grilling session on 2026-11-10. These decisions are settled. Build them; don't grill them again.

## What ships

- All of `staging` goes to `main` in **one release**. `staging` is 1,344 commits ahead, and 282 migration files are new to prod.
- **Purchasing ships visible, with a Beta tag.** There is no hide switch and no per-person nav hiding. Purchasing isn't finished, but staff keep using the group-task workaround they already like. The screens are there only because they exist, and they don't affect anything else.
- **The purchasing migrations ship anyway.** The SOR, stage-gate and permission code reads the purchasing tables, and migrations run in strict order. In prod those tables will simply sit empty.

## Decisions

| # | Decision | Answer |
|---|---|---|
| Q1 | One release or several | One release. Database first, then web. |
| Q2 | Freeze staging during the release | No. Sean is the only one working in the repo. |
| Q3 | Tell users beforehand | Already done on 2026-11-10. |
| Q4/Q8 | Rollback plan | Rehearsal, then backup, then apply, then merge. Rolling back means switching Vercel to the previous build. A database problem gets a forward fix. Restoring the backup is a last resort and needs Sean's explicit OK at that moment, because it wipes anything entered after the backup (see the no-prod-deletion rule). No Supabase branching, because it costs money and isn't needed. |
| Q5 | How to hide purchasing | Don't hide it. Add a Beta tag. No switch, and no `hidden_nav_keys`. |
| Q6/Q9 | Where the Beta tag goes | On the whole set: the Purchasing nav group, New Purchase Request, S0 Evaluation (Costing Matrix), Technical, the IPAS, Transmittal and Bid Decision approval queues, the purchasing panel in the SOR (PMS tab), and purchasing settings. The hover text reads: "Still being built. Keep using group tasks for purchasing." Screens stay usable, not locked. |
| Q7 | Copy the sales flows from staging to prod | No. Prod keeps its own flows. The staging flows hold 38 purchasing and costing conditions that would block SORs from advancing in prod. Nobody adds purchasing actions or conditions to prod flows. |
| Q10 | The New Purchase Request button, which every employee sees | Leave it usable, with the Beta tag (allow and warn). Tell the purchasing team in one line. |
| Q11 | Odoo P0 and supplier edge functions | Deploy them to prod, so the Beta pages work. As far as the code shows they only read from Odoo. |

## Build work before the release

1. **Beta tag.** Make one small Primitive badge, "Beta", with the hover text above as a tooltip (CONTEXT.md, "Hover detail"). Put it on every item in Q6/Q9. Nav entries live in `src/constants/navigation.js` (the Purchasing group, `sales.costingMatrix`, `sales.technical`, `approvals.ipas`, `.transmittals`, `.bidDecisions`, `quick.purchaseRequest`). The SOR panel is `src/components/sor/modal/PmsTab.jsx`.
2. Ship it to staging, check it there, and only then start the release.

## Release day steps

Follow `docs/production-cutover-runbook.md` where it applies. In order:

1. **Rehearsal.** Push a `rehearsal/**` branch. `cutover-rehearsal.yml` runs all migrations against a copy of prod on a GitHub machine, and only reads prod. If it fails, stop. Prod is untouched.
   - Also confirm here that the **old web app still works on the new database**. The only dropped columns and tables are purchasing ones, which prod doesn't have. But 43 migration files replace, rename or drop functions, and those haven't been checked one by one.
2. **Note the current prod build** in Vercel, so you know exactly which build to switch back to.
3. **Backup.** Push a `backup/**` branch to run `prod-backup.yml`. **Download the dump to your PC right away. The GitHub copy deletes itself after 1 day.**
4. **Ledger check**, then the **migrate-prod** workflow (`confirm=apply`). Verify the project ref against `.env` first (prod is `epqmberwewztzbrkhhss`).
5. **Deploy edge functions** (`deploy-edge-functions.yml`, `environment=prod`), including the Odoo P0 and supplier functions.
6. **Policy diff** (`pnpm db:policy-diff`). It must come back empty.
7. **Merge `staging` into `main`.** This ships the new screens to all staff. Vercel deploys it immediately.
8. **Smoke test on prod.** Check the SOR register, an SOR modal, the Beta tags and their hover, and that no SOR is stuck on a stage gate.
9. If the web app breaks, switch Vercel back to the build from step 2.

## Not doing

- No hide switch, build flag or `app_settings` toggle for purchasing.
- No copying sales flows from staging.
- No staging freeze.
- No database branching.

## Known prod risks to keep in mind

These come from past releases and haven't been re-checked for this one:

- The migration ledger has drifted before. The ledger check and the policy diff are the guards.
- The RLS cutover once blanked registers (sor_read). It was fixed by the Legacy Pipeline backfill on 2026-09-29, but the fix isn't confirmed here.
- 4 SORs, worth ₱10.39M, are missing a contract date and drop out of Realized.
- Migrations from #849, #851, #852 and #856 were only tested by CI (`docs/TODO-2026-11-04.md`).
