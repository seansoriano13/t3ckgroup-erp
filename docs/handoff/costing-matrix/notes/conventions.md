# Conventions that bind the Costing Matrix work

Repo root for all paths: `D:\Sean\t3ckgroup-erp-costing` (branch `integrate/costing-matrix`,
= staging HEAD 7c10ef8a + one empty commit `9de2aafe chore(costing): start the Costing Matrix branch (#266) [skip ci]`).

## Migrations (AGENTS.md "Database migrations")

- File name: UTC timestamp prefix, `supabase/migrations/YYYYMMDDHHMMSS_name.sql`
  (ADR 0007). Never a sequential number. `supabase migration new <name>` scaffolds one.
- **Newest migration on staging: `20261017220000_ipas_standing_for_sor.sql`.** New files
  must sort after it. (Purchasing precedent: an integrate branch re-stamps its never-shipped
  migrations to sort after staging's newest before it lands — AGENTS.md "Purchasing is built
  on integrate/purchasing".)
- Append-only: never rename/edit a migration that is on `staging`/`main`. Fix with a new
  forward migration.
- Re-runnable. Postgres has no `create policy if not exists`, so always
  `drop policy if exists "<same name>"; create policy "<same name>" ...`.
  Use `create table if not exists`, `create or replace function`,
  `drop trigger if exists x; create trigger x`, `drop constraint if exists` + `add constraint`,
  `insert ... on conflict do nothing`.
- House header: a comment block naming the issue, WHAT THIS ADDS, ACCESS, and
  "SAFE TO RUN AT ANY TIME ... Idempotent." (see `20261013100500_ipas_bank_details.sql`,
  `20261017210000_order_ageing_rules.sql`).
- Grant pattern for every function:
  `revoke all on function public.f(args) from public, anon;` then
  `grant execute on function public.f(args) to authenticated;`.
  Internal helpers: `revoke all ... from public, anon, authenticated;` (no grant).
- Tables written only by RPC/trigger: `revoke insert, update, delete, truncate on public.t from anon, authenticated;`
- A row the app needs (settings row, presets, signer-list seeds) goes in a migration as an
  idempotent insert, never a script.
- **Schema mirror:** a migration that changes schema also updates
  `supabase/schema/staging.sql` in the same PR: `supabase db reset`, then
  `pnpm db:snapshot:local`, commit the diff. The PR gate (`.github/workflows/migration-gate.yml`)
  replays every migration from empty and compares with that file. Local check:
  `node scripts/db-snapshot.mjs --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres --check --against supabase/schema/staging.sql`
  `supabase/schema/prod.sql` is prod's mirror; never edit by hand.
- Never apply to a remote project (no MCP `apply_migration`/`execute_sql` against
  `fpjxdyowngpnovotbzqi` staging or `epqmberwewztzbrkhhss` prod). CI applies.
- One local Supabase stack serves every worktree. Agent instructions for this run: do NOT
  run `db:reset` (orchestrator's rule).

### The fake database reads migrations (important for SQL layout)

- `src/test/db/schema.js` parses every migration in filename order into the in-memory fake
  (tables, columns, types, NOT NULL, DEFAULT, PK, UNIQUE, FK by constraint name, simple CHECKs).
- It cuts each file at the first line `-- Functions\n` (`truncateBeforeFunctions`). Its parser
  does not understand `$$` dollar quoting, so DDL after a function body may be mis-split.
  Existing hand-written migrations simply put tables before functions; keep table DDL above
  any plpgsql, or put a `-- Functions` marker line before the function section.
- CHECKs it enforces: enum lists (`x in (...)`/`= ANY (ARRAY[...])`) and simple comparisons
  (`x > 0`). Cross-column CHECKs (e.g. note required when `deviates`) are not enforced by the
  fake — prove them in the policy tier.
- Row triggers are NOT parsed: `src/test/db/triggers.js` mirrors a few by hand. Triggers
  that depend on the actor (`get_employee_id()`) are deliberately not mirrored (see the
  comments on `sor_procurement_requests` there). Band triggers belong to the policy tier.
- RPCs are not executed: tests stub them (`stubRpc`, `src/test/stubs/*.js`).

## Changelog

- `src/data/changelog.json`, newest entry FIRST. Shape:
  ```json
  { "date": "2026-10-16", "title": "SOR: where its orders stand", "version": "1.9.35",
    "changes": ["Plain sentence for non-technical users.", "..."] }
  ```
  Optional `"link": "/release-notes"`. Current top version: **1.9.35**.
- Helper: `node scripts/add-changelog.mjs --version 1.9.36 --title "..." --change "..." --change "..."`
  (refuses a duplicate version).
- AGENTS.md: required for any behaviour/UI change, before pushing. High level, simple words.

## Commits

- Purchasing precedent (AGENTS.md): one commit per ticket on the integrate branch,
  `feat(purchasing): … (#NNN)`, tests green, policy tier green for a schema ticket.
  Recent styles: `feat(ipas): …`, `feat(transmittals): … (#258)`, `feat(sor): … (#257)`.
  This branch's first commit uses scope `costing`: `chore(costing): … (#266)`.
- End messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (session rule).
- User memory: never `git add` uncommitted WIP of others or `git reset --hard` a shared
  checkout; "dont run ci" means `[skip ci]` on every push.

## Lint and tests

- `pnpm lint` (eslint), `pnpm lint:primitives` (no raw `<button> <input> <textarea> <select>
  <label> <table> <img> <a>` or hand-rolled modal outside `src/components/ui/`; never
  `eslint-disable` it — ADR 0025). Every routed page renders through `ui/PageShell.jsx`.
- Never run the whole suite while working (`pnpm test` ≈ 20 min). Run a file/folder:
  `pnpm vitest run src/utils/costingMath.test.js`, or `pnpm vitest run --changed HEAD`.
- Vitest projects (`vitest.config.js`):
  - **logic** (node, no setup): `src/utils/**`, `src/constants/**`, `src/lib/pdf/**`,
    `src/test/scripts/**` — put `costingMath` tests here (pure).
  - **services** (node + fake Supabase, `src/test/setup.harness.js`): `src/services/**`.
  - **screens** (jsdom): everything else incl. `src/components/**`, `src/test/pages/**`.
  - Page tests live in `src/test/pages/` (a test under `src/pages` becomes a route).
- Render-time code must not throw on in-progress input (AGENTS.md "Render-time errors must
  not throw"): use `safe*` variants in render; catch submit errors → `toast.error(err.message)`.
- Timezone pinned to Asia/Manila in tests. Expected values are literals.

### Policy tier (real Postgres, local stack)

- Config `vitest.db.config.js`: includes `src/test/policy/**/*.test.js`, single fork, no
  parallelism, files run in name order. `globalSetup` = `src/test/policy/support/global-setup.js`
  (asserts stack reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres`,
  installs a `realtime.send` no-op shim, tears down + reseeds the cast).
- `pnpm test:db` = `supabase db reset --local && vitest run -c vitest.db.config.js` (WIPES local
  data). `pnpm test:db:only` runs against the stack as is. One file:
  `pnpm vitest run -c vitest.db.config.js src/test/policy/78-....test.js`
- Next free file number: **78** (last is `77-ipas-standing-for-sor.test.js`).
- CI runs it on any change under `supabase/migrations/` (`.github/workflows/policy-tests.yml`).

## CONTEXT.md glossary (repo root, lines ~818–930)

- **PMS (Purchasing Monitoring System)** (l.818): one SOR's whole purchasing file — product
  questions, the Costing Matrix, the Purchase Request, each IPAS, Transmittals, Packing Lists.
  Avoid "Purchasing" for one SOR's file. Avoid "Sales Offer Matrix".
- **Costing Matrix** (l.827): the part of PMS where Sales, Purchasing and Management cost one
  SOR's offer item by item, closing on a summary (tax, retention, collected, revenue). Every
  column belongs to one side (Sales = Deal Team, Purchasing, Management, Technical for
  compliance); only that side writes it. Avoid: PMS sheet, Costing Sheet, Project Evaluation.
- **Tender Line** (l.839): one thing the client asked for — spec, quantity, ABC, Final Offer.
  Typed, or picked from an SOR line whose name/qty/unit it keeps. Avoid "line item", "SOR line".
- **Component** (l.845): one thing T3CK supplies toward a Tender Line, own brand/sourcing/costs/
  markup. A component priced as a whole is a **bundle** and lists its Inclusions. A Requested
  Item names the component it buys for. Avoid "part", "sub-item". (UI: "Component" is
  taken — the shared UI building blocks are called **Primitives**.)
- **Inclusion** (l.555): an unpriced item that comes with a bundle Component; listed so it can
  be checked as included. Anything bought on its own is a Component. **Completeness**:
  Covered / Missing / Substituted / Not required (Not required drops out of the fraction).
- **Final Acquire** (l.854): the cost Management sets on a Component; the summary reads it as
  Operational Expenses. Written only by the list Super Admins keep. ≠ Acquire (Purchasing's
  proposed cost, markup base) ≠ Landed Cost.
- **Closed Book** (l.862): Final Acquire, the markup factor, the summary, achieved markup,
  projected margin, Bid Decision numbers — read only by Super Admins and the Final Acquire list.
  Purchasing proposes Acquire and never sees Final Offer; Sales reads peso Markup Price, types
  Final Offer, sees neither cost nor factor. Always sees reads the price side. Database serves
  each side its own column list. Distinct from write bands. Avoid "Margin Tier", "Band".
- **Incharge** (l.878): the salesperson and purchaser who answer for a row; matrix default,
  row override. Names only: grants no access, sends no notifications. Avoid "Assignee",
  "Owner", "Buyer".
- **Markup** (l.887): a factor on a Component's Acquire suggesting its Markup Price. One
  matrix default (typed or from business-edited presets), overridable per component/cost-only
  row; cost-only rows start ×1.00. **Set by the Final Acquire list** and Closed Book.
  Avoid "Margin", "Mark-up percentage (as the stored form)".
- **Evaluation of Specification** (l.~896) and **Compliance** (Complies / Deviates / unjudged;
  deviation always written down). **ITR**: 8% of Final Offer above ₱250,000.
- **Bid Decision** (l.921): Go / No-go / Revise with a reason, stamped with Final Offer total
  and ABC; cleared by any later Final Offer or Final Acquire change; **no** no-self-approval
  rule.
- Related: **Deal Team** (l.234), **Always sees** (l.242), **Stage Participant** (l.257),
  **Restricted Stage** (l.273), **Stage Action** (l.319), **Optional Action** (l.349),
  **Stage Condition** (l.356 — already lists "costing settled"), **Requested Item** (l.529).

## ADRs to know

- `docs/adr/0013-atomic-decision-rpcs.md` — every decision is one plpgsql function that locks
  and writes together.
- `docs/adr/0014-html-rendering-pipeline-for-hr-forms.md` — print pipeline (see print-pipeline.md).
- `docs/adr/0021-stage-scoped-sor-visibility.md` — Deal Team / participants; amendment
  2026-09-15 is the old "matrix money for Purchasing/Finance" rule that #319 overturns.
- `docs/adr/0033-purchasing-tools-mount-on-sales-flow-stages.md` — the matrix exists only once
  "Open Costing Matrix" runs; costing conditions read unmet with no matrix; publish warning.
