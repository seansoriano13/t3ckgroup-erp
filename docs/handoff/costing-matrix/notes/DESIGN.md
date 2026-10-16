# Costing Matrix build — orchestrator decisions (binding for every implementer)

Spec: #266 (scratchpad/spec266.md). Tickets: scratchpad/issue-NNN.md. Read the ticket's
**comments** too — the amendments (#316 on 2026-09-17, #461 on 2026-10-05) override the
ticket body where they conflict. Code facts: scratchpad/notes/INDEX.md.

PR: https://github.com/seansoriano13/t3ckgroup-erp/pull/539, branch `integrate/costing-matrix`
(worktree D:\Sean\t3ckgroup-erp-costing). Each ticket is built on branch `costing/NNN` in
worktree `D:\Sean\t3ckgroup-erp-cNNN`, cut from the current `integrate/costing-matrix`.

## Scope (user-approved 2026-10-16)

Tickets #267–#274 plus #319 (Closed Book), #320 (Bid Decision), #462 (Open Costing Matrix),
#463 (Costing priced). The amendments are in force:
- **No matrix at registration, no backfill.** A matrix exists only once
  `costing_open_matrix` runs (wired to the Stage Action in #462). The PMS tab exists for every
  SOR the caller may see; its Costing Matrix section renders only when the matrix exists —
  a normal state, not an error, and no empty grid.
- **Closed Book (#319) shapes every read** (below).
- **Markup factor** (default and row overrides) is written by the Final Acquire list
  (management band), not Purchasing (#224 amended). Achieved markup is Closed Book only.
- **Bid Decision (#320)** has no self-approval rule (#320 amended).
- Finance: drops out of reading the matrix (#319). The spec's *write* bands are unchanged:
  Finance access or the Final Acquire list write Marketing/OPEX; Finance or Super Admin edit
  rates. Landed Cost is #283, out of scope.

## Task graph

```
267 ─ 268 ─┬─ 269 ──────────────┬─ 319 (Closed Book audit)
           ├─ 270 ─ 320 ─┬──────┤
           ├─ 271 ───────┼─ 272 ┴─ 274 (needs 269, 270, 271, 320)
           ├─ 273        │    └─ 463 (needs 272, 462)
           └─ 462 ───────┴────────┘
```
272 needs 270, 271, 320. 463 needs 272, 462. 274 needs 269, 270, 271, 320. 319 needs 269, 270.

## Reserved names (avoid collisions between parallel tickets)

| Ticket | Migration timestamp | Policy test file |
|---|---|---|
| 267 | 20261018100000 | 78-costing-tender-lines.test.js |
| 268 | 20261018110000 | 79-costing-components.test.js |
| 269 | 20261018120000 | 80-costing-markup.test.js |
| 270 | 20261018130000 | 81-costing-summary-final-acquire.test.js |
| 271 | 20261018140000 | 82-costing-evaluation.test.js |
| 273 | 20261018150000 | 83-costing-purchase-request-items.test.js |
| 462 | 20261018160000 | 84-open-costing-matrix-action.test.js |
| 320 | 20261018170000 | 85-costing-bid-decision.test.js |
| 272 | 20261018180000 | 86-costing-settled-condition.test.js |
| 463 | 20261018190000 | 87-costing-priced-condition.test.js |
| 274 | 20261018200000 | 88-costing-print-signoffs.test.js |
| 319 | 20261018210000 | 89-costing-closed-book-tiers.test.js |
| review fixes | 20261018220000 | — |

If a ticket needs a second migration, use its timestamp + 1 minute (e.g. 20261018110100).

## Shared local database — one writer at a time

There is ONE local Supabase stack for every worktree. Never point anything at staging or prod.
An agent whose prompt says **"DB: yours"** may use it freely. An agent whose prompt says
**"DB: take the lock"** must hold the lock for every `pnpm db:reset` and policy-tier run:

```bash
L="$(git rev-parse --path-format=absolute --git-common-dir)/costing-db.lock"
for i in $(seq 1 18); do mkdir "$L" 2>/dev/null && echo "$TICKET $(date)" > "$L/owner" && echo GOT && break; sleep 30; done
```
If it does not print GOT, run it again (another ticket holds the DB; `cat $L/owner` says who).
While holding it: `pnpm db:reset` (your branch's migrations), then your policy tests (yours
plus 78/79 and any you might affect). Release IMMEDIATELY after, even on failure:
`rm -rf "$L"`. Don't hold it while you edit code — release, fix, re-take. Never delete a lock
you don't own.

**Dependency change:** #462 waits for #269 (its config names a markup preset).

## Access model (built in #267, extended by every later ticket by registry rows)

Two registries keep parallel tickets from rewriting each other's SQL functions. **Later tickets
add rows; they do not `CREATE OR REPLACE` the generic functions** unless their ticket truly
needs a behaviour change (say so in the report).

### Read tier — resolved in the database, never passed in
`costing_tier(opp uuid) returns text` (SECURITY DEFINER, stable), first match wins:
1. `closed_book` — Super Admin, or on the `final_acquire` signer list
2. `cost` — has Purchasing access (`has_purchasing_flow`)
3. `price` — Deal Team, or the flow's Always sees
4. `participant` — Stage Participant with an open window (#208)
5. null — nothing

`costing_can_read(opp)` = tier is not null.

### Column read registry
`costing_column_tiers(table_name text, column_name text, tiers text[], primary key(table_name, column_name))`.
Default-deny: a column not registered is never returned to anyone but via base-table reads.
Non-money columns are registered for all four tiers. Virtual (computed) columns may be
registered too (e.g. `costing_components.markup_price_unit`, tiers `{price,closed_book}`).

`costing_matrix_read(opp uuid) returns jsonb` (SECURITY DEFINER): the matrix and arrays of its
rows per table, each row filtered with the registry for the caller's tier — **disallowed keys
absent, not null**. Returns null when the tier is null or no matrix exists.
`costing_history(opp uuid, ...)` filters `costing_events` the same way (an event on a column
is visible only to tiers allowed that column).

Base-table SELECT policies: non-money tables (`costing_matrices`, `costing_tender_lines`,
`costing_components`, `costing_inclusions`, …) need `costing_can_read`; money tables
(`costing_matrix_money`, `costing_tender_line_prices`, `costing_component_costs`,
`costing_cost_rows`) and `costing_events` are SELECTable by `closed_book` only. The service's
`get` always reads through `costing_matrix_read`.

Markup Price is computed in SQL inside the read (acquire_unit × effective factor, half-up to the
centavo) so the price tier gets the peso figure without Acquire or the factor. Everything else
(line totals, summary, achieved markup, roll-ups, costingSettled) is computed in JS by
`costingMath` from what the tier received; absent inputs ⇒ that figure is absent.

### Write bands
`costing_column_bands(table_name text, column_name text, bands text[], primary key(table_name, column_name))`
— column `'*'` means insert/delete of a row. Bands: `sales` (Deal Team), `purchasing`
(`has_purchasing_flow`), `management` (`final_acquire` list), `technical`
(`costing_is_technical`, #271), `finance` (`has_finance_flow`), `super_admin_only`.
Super Admins pass `sales`, `purchasing`, `technical`; never `management`.

One generic BEFORE INSERT/UPDATE/DELETE trigger function `costing_enforce_bands()` on every
costing table: UPDATE checks each registered column whose value changed; INSERT checks `'*'`
and each registered column given a non-null value; DELETE checks `'*'`. Unregistered columns
(ids, matrix_id, timestamps, created_by) pass. Service role / no `auth.uid()` bypasses
(migrations, SECURITY DEFINER internals that set a local flag if needed).
Refusal: `raise exception using errcode = '42501', message = 'costing_band:<table>.<column>:<bands>'`.
The service maps it to a typed `CostingBandError { table, column, bands }` the grid shows inline.

### Writes to money tables
The caller usually cannot SELECT a money table, so writes there go through SECURITY DEFINER
RPCs (ADR 0013 style) — e.g. `costing_set_money(p_table text, p_row uuid, p_patch jsonb)`
with a whitelist of tables/columns, applying the patch so the band trigger judges it with the
real `auth.uid()`; it returns nothing (no leaking RETURNING). Row inserts/deletes on money-only
tables (cost-only rows) get their own RPCs in #268. Non-money tables are written directly
through PostgREST under RLS (write policies require `costing_can_read`; the band trigger
decides).

### Matrix creation
`costing_open_matrix(opp uuid, p_config jsonb default '{}')` — SECURITY DEFINER, idempotent:
creates the matrix and its `costing_matrix_money` row if absent; on a later call fills only
what is empty (incharges, default factor/preset). Not granted to `authenticated` until #462
decides who runs it; tests call it as service role. #462 wires it to the Stage Action.

## Corrections to the spec (from the code map — these win over the spec text)

- Helpers are `has_purchasing_access()` / `has_finance_access()` (the `has_*_flow` names are
  `employees` columns). "Employee code" = `employees.call_sign` (seed 101 / 1001 by call_sign;
  if the employee is absent on a fresh DB, seed nothing and don't fail).
- SOR lines get new ids on every save (`sor_replace_items`). A Tender Line picked from a line
  stores `sor_item_id` for the pick only; "SOR line now says …" and stock find the current line
  the way `purchase_request_item_lines` does: by Odoo product id, else by name.
- The "Evaluation of Specification" template is not seeded by any migration. Seed
  `evaluation_template_id` by name when found, else leave null (Super Admin sets it in
  settings). Policy tests create their own template.
- `costing_events` is append-only: add a purge helper in `src/test/policy/support/` (copy
  `support/ipas.js`) and wire it into `teardownCast()`, or SOR deletes in teardown fail. The
  append-only trigger must not block an SOR's cascade delete if the IPAS pattern allows it.
- Stage Conditions are evaluated only in the browser (`opportunityService`); a condition
  result has no "detail" today — #272 adds it (and `StageChecklist` shows it).
- Flow Canvas has blockers, not warnings — #463 adds the first warning.
- Printing is portrait-only today — #274 adds landscape.
- Band refusals travel in the PostgREST `message`; parse `costing_band:<table>.<column>:<bands>`.
- Purchasing settings tab is visible only to Super Admin and Purchasing access. #270 lets
  Finance access open it to see only the Rates section.
- `purchase_request_items.source` allows `sor_line`/`new`; #273 adds `component`.
  "Add from the Costing Matrix" is Purchasing access only.
- `sor_open_purchase_request` has a `TODO(#266)` for a Costing Purchasing Incharge buyer
  option — #462 resolves it.

## Maths
`costingMath` is one pure JS module (path chosen in #267, e.g. `src/utils/costingMath.js`),
used by the service, the screen, the print and the condition evaluators. There is no decimal
library: compute with BigInt — money as centavos, factors and rates scaled to 10^6 — and round
half-up to the centavo only on return (return numbers in pesos, 2 dp). No new dependency.
Blank (null/undefined) never counts as zero.

## Conventions
- Commit message: `feat(costing): <what> (#NNN)` + the Co-Authored-By trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. One or a few commits per ticket.
- Changelog entry per ticket (see notes/conventions.md for where).
- Run unit/service/page tests for what you touch, and lint on your files.
- Do not push. Do not touch D:\Sean\t3ckgroup-erp (the user's live checkout).
