# Stage Conditions, Stage Actions, Stage Visits

## Where the gate runs: CLIENT SIDE

There is no database enforcement of Stage Conditions. `sor_guard_stage_move()` (BEFORE UPDATE OF
flow_stage_id) only checks `sor_access_level = 'full'` and Restricted Stage shut-out. Conditions
are evaluated in JS by `src/constants/stageGate.js` (pure) from evidence that
`src/services/opportunityService.js` loads. Evidence the mover might not be able to read
through RLS is fetched through a SECURITY DEFINER RPC (Purchasing settled's precedent).

## `stage_conditions` kind CHECK

Table: id, stage_id, kind, label, is_required, sort_order, config jsonb, archived_at, created_at, updated_at.
Current CHECK (`stage_conditions_kind_chk`, last set in `20261005130700_purchasing_settled_condition.sql`):
`('attachment','field','tickbox','assignment','deadline','project_evaluation','inclusions','purchasing','purchasing_settled')`.
Add a kind by drop + re-add, keeping every old kind (published Flow Snapshots and snapshot
restore re-insert old kinds):
```sql
alter table public.stage_conditions drop constraint if exists stage_conditions_kind_chk;
alter table public.stage_conditions add constraint stage_conditions_kind_chk check (kind in (
  'attachment','field','tickbox','assignment','deadline','project_evaluation','inclusions','purchasing','purchasing_settled', /* new */ ...));
```
The fake DB enforces this enum, so service tests need the migration too.

## JS registry — `src/constants/stageGate.js`

- `CONDITION_KINDS` (object of kind strings) — add e.g. `COSTING_SETTLED: "costing_settled"`.
- `NEW_CONDITION_KINDS` — the kinds the picker offers for a NEW condition AND the validation list
  in `src/services/stageConditionService.js` (`const VALID_KINDS = NEW_CONDITION_KINDS`).
  Retired/hidden kinds (`field`, `project_evaluation`, `inclusions`, `purchasing`) are simply left
  out of this array but stay in `CONDITION_KINDS` and keep evaluating.
- `evaluateCondition(condition, { opportunity, attachments, members, statusRow, asOf, hasInclusions,
  hasPurchasing, purchaseRequestItems, purchaseRequestAsOf })` → `{ status, satisfiedBy, satisfiedAt }`
  where status ∈ `CONDITION_STATUS.SATISFIED|UNSATISFIED|NOT_APPLICABLE`. A switch per kind;
  `default:` → unsatisfied. Purchasing settled branch:
  ```js
  case CONDITION_KINDS.PURCHASING_SETTLED: {
    if (purchaseRequestItems === undefined) return unsatisfied()   // nobody loaded it: fail closed
    return isSettled(purchaseRequestItems, { asOf: purchaseRequestAsOf }) ? satisfied() : unsatisfied()
  }
  ```
  **There is no `detail` field in the result today.** Nothing carries "which checks fail" to the
  UI; costing_settled needs a new field (e.g. `failing`) threaded through the callers below.
- `evaluateCrossing({...same evidence})` — legacy pipeline (non-flow) path; also takes the evidence.
- `blockingConditions(conditions)` — active, required, not deadline.

## Evidence loading — `src/services/opportunityService.js`

Resolver pattern (l.~470-485):
```js
async function resolvePurchaseRequestItems(conditions, opportunityId) {
  const needsIt = conditions.some((r) => r.kind === CONDITION_KINDS.PURCHASING_SETTLED);
  if (!needsIt) return undefined;
  const { data, error } = await supabase.rpc("sor_purchase_request_item_states", { p_opportunity_id: opportunityId });
  if (error) throw error;
  return data ?? null;
}
```
Every evaluateCondition call site must be given the new evidence (5 places):
1. `assertStageGateSatisfied` (l.~500, legacy pipeline move) via `evaluateCrossing`.
2. `assertCanLeaveStage({ existing, from, currentVisit, snapshotConditions, snapshotStageFields })`
   (l.1091) — the flow move. Throws `Error("Cannot leave <stage> — missing: <labels>.")` with
   `error.isGateBlock = true`, `error.missingConditions = [{stage, condition}]`.
3. `getStageChecklist(opportunityId, opportunity)` (l.3824) → rows `{ condition, status, satisfiedBy, satisfiedAt }`
   (NOT_APPLICABLE rows dropped).
4. `getBlockedDeals(opportunities)` (l.3893) — register's bulk read.
5. `getJourney(opportunityId)` (l.4136) — History; past visits pass `purchaseRequestAsOf: visit.leftAt`.

## Purchasing settled end to end (prior art for costing_settled)

- Migration `supabase/migrations/20261005130700_purchasing_settled_condition.sql`: CHECK widened;
  RPC `sor_purchase_request_item_states(p_opportunity_id uuid) returns jsonb` — plpgsql STABLE
  SECURITY DEFINER; refuses `get_employee_id() is null` and `sor_access_level(...) = 'none'` with
  42501; returns only what the gate needs (status + timestamps) or null; grants to authenticated.
  Data update converts live draft rows of the old kind (published snapshots untouched).
- Pure: `isSettled` in `src/constants/purchaseRequest.js`; unit tests in
  `src/constants/stageGate.test.js` (`describe("evaluateCondition — purchasing_settled kind (#311)")`:
  no request → satisfied; open/closed; "fails closed when nobody loaded the evidence"; asOf).
- Service/integration: `src/services/purchasingSettled.test.js` — seeds `seedPipeline()`,
  `makeSaleType/makeSalesFlow/makeFlowStage/makeFlowEdge/makeStageCondition/makeFlowSnapshot`,
  `makeOpportunity({ sale_type_id, flow_stage_id, flow_snapshot_id })`, stubs
  `stubActionRunRpcs()` + `stubPurchasingSettledRpc()` (`src/test/stubs/purchasingSettledRpc.js`,
  the RPC re-implemented on `db.internal.rowsOf(...)`), then
  `await expect(opportunityService.updateStatus(deal.id, qualified.id, owner.id)).rejects.toThrow(/Purchasing settled/)`
  and `opportunityService.getStageChecklist(deal.id)` → `[["purchasing_settled","unsatisfied"]]`.
- Policy: `src/test/policy/42-purchasing-settled-condition.test.js` — CHECK accepts the kind
  (insert as service role), RLS hides the request from a left-out Deal Owner but the RPC answers,
  RPC returns only status/timestamps, null with no request, refused for an outsider and anon;
  re-runs the migration file via `sql().query(readFileSync(...))` to test the data conversion.

## Flow Canvas labels — `src/components/flow-canvas/flowStageKinds.js`

- `CONDITION_KIND_META[kind] = { label, icon (lucide-react), hint }`, e.g.
  `[CONDITION_KINDS.PURCHASING_SETTLED]: { label: "Purchasing settled", icon: PackageCheck, hint: "Every Requested Item is closed. Met when there is no Purchase Request." }`
- `ACTION_KIND_META[kind] = { label, icon, hint, titled? }`; `open_purchase_request` has
  `titled: false` (named by its label). `conditionDetail(condition)` (config summary line),
  `actionTitle`, `actionSummary`.
- Consumers: picker `StageConditionManager.jsx` (l.265 maps `NEW_CONDITION_KINDS` through META),
  canvas `FlowSatelliteNode.jsx`, published versions `src/components/sor/FlowVersionStagePanel.jsx`
  (l.157 `CONDITION_KIND_META[row.kind]`, l.186 `ACTION_KIND_META[row.kind]?.icon ?? Wand2`).
  Tests: `flowStageKinds.test.js`, `StageConditionManager.test.jsx`,
  `src/components/sor/FlowVersionStagePanel.test.jsx`, `src/test/pages/flowVersionSnapshot.test.jsx`.
- SOR-side checklist row: `src/components/sor/StageChecklistRow.jsx` has its own `KIND_LABELS`/
  `KIND_ICONS` (only attachment/field/tickbox/assignment; others fall back to `condition.kind`
  text and a Circle icon). Parent `src/components/sor/StageChecklist.jsx` maps
  `checklist.map(({ condition, status, satisfiedBy, satisfiedAt }) => <StageChecklistRow .../>)`
  — a failing-checks prop must be added to both. Tests: `StageChecklist.test.jsx`
  (`renderWithProviders`, fake DB).

## Flow Canvas publish

- `salesFlowService.lockFlow(flowId, actorId, note)` (`src/services/salesFlowService.js` ~l.945):
  `flowLockBlockers({ stages, edges, wonStageId })` from `src/constants/salesFlow.js` (l.126) —
  **blockers refuse** the publish (thrown as one message). `buildSnapshotData` (l.~194) builds
  `snapshot_data` = stages, edges, flat `actions`, `conditions`, `stageFields`, `formFields`,
  `followUps`, `access`. Then RPC `lock_sales_flow`.
- **No publish-warning mechanism exists.** Closest: `config.accessFallbackWarning` flag on an
  action/condition config, shown as a node badge (`FlowCanvas.jsx` l.~744
  `hasAccessFallbackWarning`). Reachability helper: `stagesReachableFrom(stageId, edges)` in
  `src/utils/stageGraph.js` (used by `AccessWindowConfig.jsx`).

## Stage Actions

Table `flow_stage_actions`: id, stage_id, kind, config jsonb, sort_order, archived_at, …
CHECK `flow_stage_actions_kind_chk` = `('create_group_task','create_individual_task','open_purchase_request')`
(set in `20261005130200_open_purchase_request_action.sql`). JS list duplicated in
`src/services/stageActionService.js` `VALID_KINDS`.
Runs: `sor_action_runs` (id, opportunity_id, stage_id, action_id, stage_visit_id, outcome
CHECK `pending|created|skipped|failed`, decider jsonb, decided_by/at, task_id, group_task_id,
purchase_request_id (added in `20261005130300_open_purchase_request_fixes.sql`, `on delete set null`),
closed_off_at/reason, carried_from_visit_id, held_at). A new tool needs its own id column.

### Open Purchase Request (#304) end to end

- Config (saved by `src/components/flow-canvas/PurchaseRequestActionModal.jsx`, documented in
  `src/utils/purchaseRequestAction.js`): `buyer` (`{type:"employee", id}` | `{type:"costing_incharge"}`
  (`BUYER_COSTING_INCHARGE`) | null), `extras` (people selectors), `leaveOutRoles`, `requesters`,
  `confirmMode: "confirm"|undefined`, `decider` (selectors), plus `access {until, stageId}` edited in
  the detail panel (`StageActionDetail.jsx` → `AccessWindowConfig.jsx`; `handleAccessChange` in
  `StageActionManager.jsx` l.121 merges `{...config, access}`), and `carries_on`.
- Editor wiring in `StageActionManager.jsx`: `ACTION_KIND_META` drives the "Add Action" menu;
  `addingKind === "open_purchase_request"` → modal → `handleAdd(kind, config)`;
  `editingAction?.kind === ...` → same modal with `initialData`. Detail panel text in
  `StageActionDetail.jsx` (l.79 subjectLabel "Purchasing members", l.106 summary via
  `purchaseRequestSummary`).
- Runner (client) `moveAlongFlow` (opportunityService l.~690+): after the move, builds
  `actionsPayload` per action (`{action_id, kind, name, confirm, decider?...}`), resolves
  `decider_ids`, calls RPC `sor_run_stage_actions(p_opportunity_id, p_stage_id, p_stage_visit_id, p_actions)`.
  Result `{failed: [names], created: [{action_id, kind, request_id|task_id|group_task_id}]}`;
  for `open_purchase_request` the client only writes a note (`notePurchaseRequestOpened`, event
  `STAGE_ACTION_PURCHASE_REQUEST_OPENED`). `stageActionName(action)` names failures
  ("Purchase Request" for this kind).
- SQL `sor_run_stage_actions` (SECURITY DEFINER): requires edit or full access; per action
  `sor_begin_action_run` (fire once per SOR+stage+action unless closed off); `confirm` → notify
  deciders, leave pending (Optional Action); else branch on kind — `open_purchase_request` calls
  `public.sor_open_purchase_request(v_run.id, ...)`; unknown kind raises; each branch in
  `begin ... exception when others then perform sor_finish_action_run(id,'failed')`.
- `sor_open_purchase_request(p_run_id uuid, p_config jsonb default '{}') returns uuid`:
  locks the run; refuses if it already opened a request or isn't pending (or created-by-decider);
  reads the SAVED config from the Flow Snapshot via `_sor_action_run_saved_action(p_run_id)`
  (ignores the caller's config); `TODO(#266)` — the `costing_incharge` buyer option resolves to
  nobody today. Insert `... on conflict (opportunity_id) do nothing returning *`; if not created
  → **top-up**: set buyer only where null, set requesters only where null; add members
  (Purchasing access ∪ Deal Team minus leaveOutRoles ∪ extras ∪ requesters ∪ buyer) through
  `_purchase_request_add_member` (insert `on conflict do nothing`; purchasing side opens a window
  via `_purchase_request_open_window` → `sor_stage_participants` row source `purchase_request`,
  `opened_visit_id` = request's `opened_visit_id`, `until_rule` = stored `access_until`).
  Marks the run `created` with `purchase_request_id`.
- Optional Action: `opportunityService.decideAction(...)` (l.~2930): checks decider, RPC
  `sor_decide_action_run(p_run_id, p_decision, p_actor_id)`; skip → note `ACTION_RUN_SKIPPED`;
  create + `open_purchase_request` → RPC `sor_open_purchase_request({p_run_id})`, on error
  `sor_finish_action_run(failed)`. `getPendingActionsForActor` builds the Decider card
  (`target: { kind: "purchase_request" }` for this kind; `PendingActionDecisions.jsx` words it).
  Leaving a stage auto-skips pending runs (note "Not created: left X undecided.").
- Windows for task actions are opened client-side with
  `sorStageParticipantService.openWindow({ opportunityId, employeeId, source: "action", sourceId: action.id, openedVisitId, access: config.access, notify }, actorId)`
  (`src/services/sorStageParticipantService.js` l.41; dedupes open window per
  employee+source+visit). Open PR opens its windows in SQL instead.
- Tests: policy `src/test/policy/38-open-purchase-request-action.test.js` (builds sale type /
  flow / stages / two `flow_stage_actions` rows, a `flow_snapshots` row whose
  `snapshot_data.actions` carry the configs, points the SOR's visit at it, runs
  `sor_run_stage_actions` as `dealOwner` with a DECOY config; covers opens-one, left-out roles,
  windows, re-run no-op, top-up, Optional Action via decide). Fake: `src/test/stubs/actionRunRpc.js`
  re-implements `sor_run_stage_actions` but **only for task kinds** — `open_purchase_request`
  falls into "no builder" (failed) there. `stageActionService.test.js`, `StageActionManager.test.jsx`.

## Stage Visits and the timeline

- `sor_stage_visits`: id, opportunity_id, flow_stage_id, flow_snapshot_id, sequence, entered_at,
  entered_by, left_at, left_by, undone_at, contract_date_stamped, ….
- Written by trigger `record_stage_visit()` (AFTER INSERT and AFTER UPDATE OF flow_stage_id on
  `sales_opportunities`): on insert with a flow stage → visit seq 1; on move → closes the open
  visit (`left_at = now(), left_by = get_employee_id()`), holds tasks created by actions on it
  (unless `stage_action_carries_on`), inserts the next visit; terminal stage cancels held tasks.
  Skips when `current_setting('app.sor_revert') = 'on'`. The open visit = `left_at is null and undone_at is null`.
- Returns (Resume / Start fresh) go through RPCs `sor_move_and_resume` / `sor_move_and_start_fresh`
  and skip `assertCanLeaveStage` (conditions never block going back).
- `sales_opportunity_logs`: id, opportunity_id, author_id, `type` CHECK `COMMENT|SYSTEM`, content,
  metadata jsonb, created_at, stage_visit_id. BEFORE INSERT trigger `sor_set_log_stage_visit()` fills
  `stage_visit_id` with the open visit when null. Insert policy: `author_id = get_employee_id() or
  author_id is null`; read policy visit-scoped (`sor_visible_visit_ids`).
- Client writer: `opportunityService.addSystemNote(opportunityId, content, metadata, authorId)`
  (l.2824) inserts `type: "SYSTEM"`; errors are logged, not thrown. A move writes
  `Stage moved: A → B` with metadata `{ event: "STAGE_CHANGED", from, to, employeeId, stampedContractDate }`
  then `systemAuditLogService.addSystemEvent(...)`. SQL-side writers insert directly into
  `sales_opportunity_logs` (e.g. `stageConditionService` notes on deals at a stage).
