# Handoff: Purchasing demo sheet and the "one product record" question

Written 2026-10-23. The next session runs on the user's own PC, so it can run Odoo scripts and Supabase queries. This cloud session could not.

## How to talk to this user
- The project's `CLAUDE.md` says: be short, use full sentences and everyday words.
- The user said they feel overwhelmed. Lead with the plain answer, then the detail.
- Push to `staging`. The user asked for pushes **without CI**, so add `[skip ci]` to the commit message. Do not open a PR unless asked.
- Commit trailers come from the session's attribution reminder (a `Co-Authored-By` line and a `Claude-Session` line).

## What was done
1. **Scanned recent commits and updated the demo run sheet** for the new Costing Desk (commit `ed8538bc` and the access changes `2a901bd5`, `ddb07270`, `4b032bf5`). Parts 4 and 5 were rewritten. Pushed as `b9478f3e`.
2. **Found a second, unfinished rewrite** by another session (title "Untitled session", id `session_01BxASEwEwuv6R52LKcHfp5r`). It moved the demo from the generator and radio story to a real Odoo project: sale order **S03885** (Tagbilaran City Government, 5 products) and its USD purchase order **P01235**. I copied that file out of the session's history unchanged and pushed it as `3f5cd314`. The live sheet is https://claude.ai/artifact/EuSMrWHRypi3WZ7Gj7phtF (version 11).
3. **Wrote an architecture review**: https://claude.ai/artifact/CLG4eXDnrqU7YymgRWdMt3. It covers the three-copies problem, three options, questions for Sales and four read-only SQL queries. Read it first, it is the main output. It is private to the user.

## Findings you can rely on (checked in code)
- `purchase_request_add_items_from_components` always inserts a new Requested Item and never checks for an existing one. In `supabase/migrations/20261018150000_costing_purchase_request_items.sql`.
- So the old sheet (step 3.4 add from the SOR, then add from the matrix) made **two items per product**. **Fixed in `a19c1c46`:** the matrix now opens at Lead and Purchasing adds the items from the matrix only (step 3.4). That fix has **not been rehearsed on staging**.
- A Canvass belongs to exactly one Component or one Requested Item, or to nothing (ADR 0034). See `docs/adr/0034-canvass-before-purchase-request.md`.
- SOR lines are deleted and re-inserted on every save. An item finds its line by Odoo product, else by name. See `docs/purchasing-lifecycle.md` section 6.
- The Costing Desk now fills matrix lines from the SOR's products by itself (`costing_fill_from_sor`). That makes "pick from an SOR line" in the request a second copy of the same job.
- The Government flow mounts the matrix at SO Evaluation (ADR 0033), but the Purchase Request opens at Lead. At Lead there is no Component yet.

## Not verified
- The four SQL queries in the review were written from the migrations and **never run**. Check column names on the first run.
- That staging accepts "S03885" as the SOR number.
- That the "offers under the ABC" check copes with the three S03885 products that have a zero budget.
- The S03885 sheet's peso figures use the staging USD rate of 63.509 on 2026-10-23. They change daily.
- The unit-test and policy-test status of the latest costing commits. Those policy tests need a real Postgres.
- Nothing in the app was run or rehearsed. I only read code.

## Open decisions (the user's, not yours)
1. **Option B, C or A** from the review. My recommendation: take the "matrix as preview, markup calculator and Bid Decision" as a **screen**, and make the **Component the one product record** in the data (option B). Option C as a data change was judged too large.
2. **How Sales really asks for a product.** Unknown. The review has seven questions for Sales. The user can also answer from the real data.
3. ~~Fix the sheet's duplicate step~~ Done in `a19c1c46`. Side effect: only Purchasing can add from the matrix, so Sales no longer adds request items and takes part through the chat only. Check this against the Sales answers.

## Suggested next steps on the user's PC
1. Run the four queries from the review on **production** (read-only) and group the results into patterns of how Sales asks. Also scan Odoo if useful.
2. Rehearse the S03885 sheet on staging and settle the "Not verified" items above.
3. Rehearse step 0.4 and Part 3 of the sheet (matrix at Lead, items added from the matrix). If it fails, revert to the old order and skip the SOR pick. Republish the artifact with the same file path (it keeps the URL).
4. After the user decides, write option B up as a ticket or ADR.

## Watch out
- On the user's PC there may still be an **uncommitted** copy of `docs/demos/purchasing-demo-run-sheet.html` from the other session. It conflicts with the pushed version. Tell the user to run `git checkout -- docs/demos/purchasing-demo-run-sheet.html` before pulling.
- The demo reset script is `scripts/demo-purchasing-setup.mjs --apply` and it talks to the staging database. Do not point it at production.
- The sheet's tick state is stored in the browser. Step numbers in Parts 4 and 5 changed, so the user should click "Clear ticks".
- ADR conflicts for option B: none directly. It narrows ADR 0034 for projects only and uses ADR 0033's per-flow setting to open the matrix at Lead. It would revise CONTEXT.md's "Requested Item" entry.

## Suggested skills
- `grilling`: to work through option B with the user and settle the open decisions.
- `domain-modeling`: if B is chosen, to update `CONTEXT.md` ("Requested Item", "Component") and record an ADR.
- `codebase-design`: for the vocabulary of modules, seams and depth, and its design-it-twice pattern for the SOR-to-Component sync.
- `improve-codebase-architecture`: the skill that produced the review. Re-run it once the real data is in.
- `artifact-design`: before republishing either artifact.
- `tdd`: if option B or the duplicate guard gets built.
