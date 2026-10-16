# Service layer and the three test harnesses

## Service conventions

- Client: `import { supabase } from "../lib/supabase";` (`src/lib/supabase.js`, real
  supabase-js with a retrying `customFetch`; 20 s timeout). Never a second client.
- A service is an exported object literal of async methods, e.g.
  `export const purchaseRequestService = { async get(id) { ... } }`. One JSDoc block on top
  naming the issue and the rule "every write is an RPC: the database decides who may make it".
- Reads: `supabase.from(t).select(SELECT).eq(...)`; embedded employees by FK constraint name:
  `"*, requester:employees!purchase_request_items_requested_by_fkey(id, name, avatar_path)"`
  (the fake checks these names, so a typo fails the test).
- Writes: `const { data, error } = await supabase.rpc("fn", { p_arg: v }); if (error) throw error; return data;`
- Typed errors: `export class IpasError extends Error { constructor(code, message) { super(message); this.name = "IpasError"; this.code = code; } }`
  (`src/services/ipasService.js` l.74; codes in `IPAS_ERROR`, `src/constants/ipas.js` l.81);
  `TransmittalError` same shape (`transmittalService.js` l.81). Client-side validation throws
  them; **database refusals are re-thrown as the raw Supabase error** and the screen shows the
  message. Branching on a DB code exists: `if (error?.code === "55000") throw new IpasError(...)`
  (ipasService l.816).
- What a DB `raise` looks like client-side: PostgREST returns only `{ code, message, details, hint }`
  (SQLSTATE in `code`; `using detail = ...` → `details`, `using hint = ...` → `hint`; there is no
  column field). The fake mirrors this: a stub throws `pgrstError(code, message, { status, details, hint })`
  (`src/test/db/schema.js` l.638) and `errorResponse` sends `error.pgrst` as the body.
  No existing code puts a column name in `details`/`hint`; a band error naming the column has no
  precedent — the spec's "typed error naming the column" is new work.
- Stripping the function prefix for display: `ipasErrorMessage(error, fallback)` in
  `src/utils/ipas.js` l.286 (removes `snake_name:` / "packing list:", capitalises; maps network
  failures). `components/purchase-request/AddRequestedItems.jsx` has a local
  `refusal = (e) => (e?.message || "Something went wrong.").replace(/^[a-z_]+: /, "")`.
- Notifications are sent by the service when the RPC returns `notify_ids`
  (`notificationService.createNotification({ recipient_id, sender_id, type, title, message, reference_id })`),
  fire-and-forget; tests `await waitForNetworkIdle()` before asserting on them.

## Money arithmetic

- **No decimal library** in `package.json` (no decimal.js / big.js / bignumber / dinero).
- Prior art: `src/utils/landedCost.js` carries money as integer centavos:
  `const centavos = (pesos) => Math.round((finiteNumber(pesos) ?? 0) * 100); const pesos = (c) => c / 100;`
  and `allocate(total, weights)` (largest remainder). `finiteNumber(value)` exported there.
  Note `Math.round` is half-up only for positives (−0.5 → −0, i.e. toward +∞).
- Display: `formatPHP(amount)` in `src/constants/sor.js` l.365 → `₱1,234.50`
  (`toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`);
  `formatPHPCompact`. Unit tests: `src/utils/landedCost.test.js`.
- Postgres money columns elsewhere: `numeric(18,2)` (unit_price), `numeric(14,2)` (cost_amount),
  `numeric(12,2)` (quantity).

## Fake PostgREST (service and screen tiers)

- MSW intercepts HTTP; in-memory store answers as PostgREST. Setup `src/test/setup.harness.js`
  (+ `src/test/setup.dom.js` for jsdom). DB resets between tests.
- Tables come from the migrations (see conventions.md). RLS is NOT modelled: every table read
  returns every row. Anything that depends on who the caller is goes through a stubbed RPC that
  takes the actor/tier as stub options.
- `src/test/msw/postgrest.js`: `POST /rest/v1/rpc/:fn` → stub map; **an unstubbed RPC fails**
  with 404 `PGRST202` "No RPC stub registered for this test — call stubRpc()".
  `stubRpc(name, handlerOrValue)` (re-exported from `@/test/msw/server`); the handler gets the
  JSON body (`{ p_opportunity_id, ... }`) and returns the result or throws `pgrstError(...)`.
- Store API (`@/test/db/store`): `db.seed(table, rowOrRows)`, `db.rows(table)` (copies),
  `db.internal.rowsOf(table)` (live rows, for stubs), `insertRow(table, row)`,
  `updateRow(table, existingRow, patch)`, `deleteRows(table, targets)`, `db.setClock(iso)`,
  `db.nextUuid`. Inserts run NOT NULL/CHECK/UNIQUE/FK validation and `src/test/db/triggers.js`.
- Stub module pattern (`src/test/stubs/*.js`): one exported `stubXxxRpcs({ actorId, purchasing = true, ... })`
  that registers every RPC of a feature, re-implementing its logic on the store, with a header
  comment naming the migration and which rules are only proven in the policy tier.
  Examples: `purchasingSettledRpc.js` (21 lines, simplest), `purchaseRequestItemRpc.js`,
  `ipasRpc.js` (1560 lines; options `actorId, purchasing, reader, money, bankReader, finance,
  superAdmin, sorReader` — tiers as flags), `actionRunRpc.js` (`sor_run_stage_actions` for task
  kinds only), `replaceItemsRpc.js` (`sor_replace_items`).
- Factories (`@/test/factories`): `makeEmployee({ has_purchasing_flow: true, has_finance_flow: true, call_sign, is_super_admin })`,
  `makeSuperAdmin`, `makeOpportunity({ registered_by, deal_owner_id, sale_type_id, flow_stage_id, flow_snapshot_id, sales_reference })`,
  `makeOpportunityItem(oppId, { product_name, quantity, unit, unit_price, odoo_product_id, sort_order })`,
  `makeStageVisit`, `makeStageParticipant({ opportunity_id, employee_id, opened_visit_id, closed_at })`,
  `makeGroupTask({ created_by, opportunity_id, template_id, status })` (members: `db.seed("committee_task_members", {...})`),
  `makeSaleType`, `makeSalesFlow`, `makeFlowStage`, `makeFlowEdge(a, b)`, `makeFlowSnapshot`,
  `makeStageCondition`, `makeStageAction`, `makeEmployeeGroup`, `seedPipeline()`.
- Network: `waitForNetworkIdle()` from `@/test/network`.

### Service test prior art

- `src/services/purchasingService.test.js` — named by the spec as prior art, **was deleted in
  #314 (commit 96173eea)**; it no longer exists. Use instead:
  - `src/services/purchasingSettled.test.js` — a condition blocking a real `updateStatus` move.
  - `src/services/purchaseRequestItems.test.js`, `purchaseRequestItemStatus.test.js`,
    `purchaseRequestService.test.js` — RPC-backed writes with `stubPurchaseRequestItemRpcs({ actorId })`.
  - IPAS: `ipasService.test.js`, `ipasSignoffs.test.js` (sign-off wiring; real rules in policy 61),
    `ipasBankDetails.test.js` (money table read gated by a stub flag), `ipasPayments.test.js`,
    `ipasSorSummary.test.js`, `ipasSorStanding.test.js`.
  - `opportunityReplaceItems.test.js` — line replacement.
- Typical file: `beforeEach(() => { seedPipeline(); stubActionRunRpcs(); stubXxx(); ... })`,
  assert through the service, `db.rows()` only where there is no read path.

## Policy tier (real Postgres) — `src/test/policy/support/`

- `stack.js`: `serviceClient()` (service role — SEEDING/TEARDOWN ONLY), `sql()` (pg pool on
  `127.0.0.1:54322`, for questions PostgREST can't answer / re-running a migration),
  `rlsStatus(table)` → `{ enabled, policies }`, `isInRealtimePublication`.
- `cast.js`: 19 fixed identities created auth-user-first with matching `employees` rows
  (identity resolves by JWT email). Keys: `ordinary, outsider, dealOwner, support, closingSales,
  head, subHead, hr, leaveManager, flowEditor, stageParticipant, finance (has_finance_flow),
  ipasSigner, warehouse, technical, logistics, checkByTwo, superAdmin, deleted`.
  No one has Purchasing access by default — tests flip it:
  `await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant)`
  in `beforeAll` and back in `afterAll` (policy 38/42/59 do this). `ids[key]` after
  `await ensureCastLoaded()`; `await clientFor(key)` = signed-in anon-key client;
  `anonymousClient()`. Lists: insert `ipas_signer_lists` rows with the service client, clear in afterAll.
- `rows.js`: `makeSor({ registeredBy, dealOwnerId, supportSales1Id, salesDirectorId, closingSalesId, saleTypeId, flowStageId })`
  (status LEAD, service role; with a `flowStageId` the `record_stage_visit` trigger creates
  visit 1), `makeTask`, `makeGroupTask({ createdBy, memberId })` → `{ taskId, memberRowId }`,
  `MARKER = "[policy-tier]"`.
- `access.js`: `canRead(client, table, id)`, `tryInsert(client, table, row)` → `{ ok, id | code, message }`,
  `tryUpdate(client, table, id, patch)` / `tryDelete(...)` → `{ ok, affected, code }`
  (0 affected = refusal under RLS), `RLS_VIOLATION = "42501"`. These filter on an `id` column;
  a table keyed by its parent (`ipas_bank_details`, a `*_money`/`*_prices` table) needs its own
  probe (see 59-ipas-bank-details.test.js `readsBank`).
- Stage Participant fixture: insert `sor_stage_participants` with the service client
  (`{ opportunity_id, employee_id: ids.stageParticipant, source: "action", opened_visit_id: <visit id>, until_rule: "stage_left" }`);
  read the visit id from `sor_stage_visits` (`visitOf` helper in 38). See also
  `13-sor-visit-scoped-reads.test.js`, `15-stage-visit-participant-reads.test.js`.
- Deal Team: pass `dealOwnerId: ids.dealOwner, supportSales1Id: ids.support` to `makeSor`.
  Always sees: insert `flow_access_settings` for a flow (`18-always-sees-everyone.test.js`,
  `35-always-sees-department.test.js`).
- Group task on an SOR with a template: insert `group_task_templates` then `committee_tasks`
  `{ title, created_by, opportunity_id, template_id, status: "ACTIVE" }` + `committee_task_members`;
  remove membership by deleting the member row (`19-group-task-member-removal.test.js`).
- Asserting refusals: RPC → `const { error } = await (await clientFor("x")).rpc(...); expect(error.code).toBe("42501")`;
  table insert → `tryInsert(...).code === RLS_VIOLATION`; select → `canRead(...) === false`;
  trigger raise on update → `tryUpdate(...)` returns `{ ok: false, code: "42501", message }`.
  Every rule is tested both directions (permission and refusal).
- Re-running a migration on literal fixtures: `const MIGRATION = readFileSync("supabase/migrations/<file>.sql", "utf8"); await sql().query(MIGRATION)`
  (`42-purchasing-settled-condition.test.js`, `45-migrate-legacy-procurement.test.js`, `16-legacy-pipeline-backfill.test.js`).
- **Teardown hazard for append-only tables.** `teardownCast()` (cast.js) deletes
  `sales_opportunities` rows owned by fixture employees, and many files' `afterAll` delete their
  SORs with the service client. An append-only trigger on a child that cascades from the SOR
  (like `ipas_events`) refuses those deletes. IPAS solved it with `support/ipas.js`
  (`purgeIpas(ids)`, `purgeFixtureIpas(emailLike)` using `set local session_replication_role = replica`
  on a superuser pg connection, children deleted by hand) and calls it first in `teardownCast()`;
  `support/transmittals.js` does the same. A `costing_events` table needs the same purge hook
  wired into `teardownCast()` before the `OWNED_BY` deletes.
- Prior art files: `59-ipas-bank-details.test.js` (money table), `61-ipas-signoffs.test.js`
  (lists, no self-approval, clearing), `38-open-purchase-request-action.test.js` (action + top-up),
  `42-purchasing-settled-condition.test.js` (condition evidence RPC), `75-order-ageing-rules.test.js`
  (settings table Purchasing/Super Admin write).

## Page / component tests

- `renderWithProviders(ui, { client })`, `setupUser()` (no keystroke delay), `confirmMove`,
  `chooseOption` from `@/test/support`.
- Auth stub: `let authUser; vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))`
  (path relative to the test). Set `authUser = { id, isSuperAdmin, hasPurchasingFlow, ... }` per test.
- SOR modal sections: `src/components/ipas/IpasSorSection.test.jsx` (stub the section's RPCs,
  render the section alone; "renders nothing" assertion waits ~80 ms then `toBeEmptyDOMElement()`),
  `src/components/sor/modal/PurchaseRequestSor.test.jsx` (whole modal via `OpportunityDetailsModal`,
  `stubEdgeFunction("odoo-sor-lookup", {...})` because the modal auto-syncs from Odoo; navigate
  with `fireEvent.click(await screen.findByRole("button", { name: /^This stage/ }))`).
- Stage checklist: `src/components/sor/StageChecklist.test.jsx`.
- Settings tab: `src/test/pages/settingsPage.test.jsx`, `orderAgeingRulesPages.test.jsx`.
- Print from a page: `src/test/pages/ipasPrintPages.test.jsx`.
