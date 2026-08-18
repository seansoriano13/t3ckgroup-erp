# Procurement panel: reuse open tasks, add a Pending status, instant In-Progress UX

## Context

Sales raises a procurement request from a SOR by naming products and sending
them to a purchasing employee (`ProcurementPanel.jsx`'s composer). That
already supports up to 3 products per send, batched into **one** task per
send (`procurementService.createRequest` → `openTaskFor` →
`sor_raise_procurement_task` RPC). The gap: if sales sends to the **same**
buyer for the **same** opportunity a second time later (e.g. the client asks
for one more thing after the first request), nothing checks whether that
buyer already has an open requisition task for this deal — it always opens a
brand-new task. Since the purchasing-side panel
(`ProcurementResolutionPanel.jsx`) already renders *all* `sor_procurement_requests`
rows tied to one `task_id` as a list, reusing the existing open task instead
of minting a new one means the second send's product just shows up as another
row in the buyer's existing requisition — no new UI needed for that part.

Two more requests ride along with this, both scoped to the purchasing-side
panel:

- A freshly-assigned, not-yet-touched request currently shows no real status
  (the resolution panel jumps straight to a blank form; the sales panel shows
  "Assigned"). Both should read **"Pending"** — a display-only label, not a
  new outcome value in the DB (`getStatusTheme` in `src/constants/status.js`
  already has a `"PENDING"` → amber fallback, so `StatusBadge` needs no
  changes).
- Picking **"In progress"** from the outcome dropdown should save instantly
  (no PO/ETA/remarks fields — there's nothing to fill in for that outcome)
  instead of requiring the purchaser to open a form and click Save. Picking
  **"Purchased"** (or any other outcome) still opens the full form, since
  those need a PO number and/or benefit from a note.

Confirmed scope (per user's answers): the task-reuse check applies to both
the sales composer's direct send **and** the purchasing head's
buyer-assignment flow (`assignRequests`); the sales-side "Assigned" label
also becomes "Pending" for one consistent vocabulary; only "In progress"
auto-saves instantly — "Already in Odoo" and "Cannot source" keep opening the
form so a note can be added.

## 1. Reuse an open task instead of always creating a new one

**File:** `src/services/procurementService.js`

Add a private helper, e.g. `findOpenTaskFor(opportunityId, assigneeId)`:

- Query `sor_procurement_requests` for rows where `opportunity_id` and
  `assigned_to` match and `task_id is not null`, selecting the distinct
  `task_id`s.
- Look up those ids in `tasks`, filtering `status = TASK_STATUS.INCOMPLETE`
  (an auto-submitted/approved/deleted task must *not* be reused — that's a
  closed cycle, a new send should open a fresh one). Return the most recent
  match (order by `created_at` desc), or `null`.

Use it in two call sites, both of which currently call `openTaskFor`
unconditionally whenever an assignee is resolved:

- `createRequest` (~line 186-194): when `assignee` is set, call
  `findOpenTaskFor` first. If it returns a task id, skip `openTaskFor` and
  use that id directly as `taskId` for the new rows. Otherwise, fall back to
  `openTaskFor` exactly as today.
- `assignRequests` (~line 383-394): same check before calling `openTaskFor`.

When reusing, replace the "new task" notification/activity noise with a
lighter touch — add a new small method (e.g. `announceAddedToTask`) that:
- Posts a `taskActivityService.addSystemEvent(taskId, "<name> added N more product(s) to source.", { event: "PROCUREMENT_ITEMS_ADDED", ... })`.
- Sends the assignee a notification (reuse type `TASK_ASSIGNED` so existing
  notification routing/UI keeps working) with wording like `"<requester>
  added N more product(s) to source for <deal>."` instead of the "assigned"
  phrasing used for a brand-new task. Skip the head's `NEW_TASK_SUBMITTED`
  notification in this path — the head was already told about this task once.

Everything downstream (the `sor_procurement_requests` insert, the
`addOpportunityNote` call, `ProcurementResolutionPanel`'s
`listForTask`/realtime subscription, `ProcurementPanel`'s
`listForOpportunity`) needs no changes — they already render whatever rows
share a `task_id` / `opportunity_id`.

Skip updating the task's title/description item count on reuse (it would
require a direct `.update()` on `tasks` outside the existing RLS-safe RPC
path, and the activity-feed note already surfaces that more was added) —
leave `[PR] ... — N items to source` reflecting the original send.

## 2. "Pending" status label

**File:** `src/constants/procurement.js` — no new outcome value; add a small
shared helper used by both panels, e.g.:

```js
export function displayOutcome(request) {
  if (request.outcome) return { raw: request.outcome, label: PROCUREMENT_OUTCOME_LABELS[request.outcome] || request.outcome };
  return { raw: "PENDING", label: "Pending" };
}
```

**File:** `src/components/sor/ProcurementPanel.jsx` — in `RequestRow`
(~line 279-284), replace the `statusRaw`/`statusLabel` fallback logic
(`"ASSIGNED"`/`"Assigned"` vs `"REQUESTED"`/`"Requested"`) with
`displayOutcome(request)`, so both the assigned-and-unresolved case and the
not-yet-assigned case read "Pending" (an unassigned request has no buyer yet,
which is also "pending" from sales' point of view — confirm this reads right
visually since it collapses two previously-distinct labels into one; if it
doesn't, keep "Pending" only for the assigned case and leave unassigned as
"Requested").

**File:** `src/components/ProcurementResolutionPanel.jsx` — see §3 below;
the restructured pending row uses the same helper for its badge.

## 3. Instant "In progress", fields hidden until an outcome that needs them

**File:** `src/components/ProcurementResolutionPanel.jsx`

Today `open` (unresolved) requests render via `OpenRow` → the full
`ProcurementEditForm` immediately, with a blank outcome dropdown; the fields
block (`{outcome && (...)}`, ~line 283) only checks truthiness, so picking
"In progress" (a non-empty string) reveals the PO/Odoo-ref/ETA/remarks
fields even though none of them apply, and still needs an explicit Save
click. Resolved requests (`resolved = requests.filter(r => r.outcome)`,
which already includes `IN_PROGRESS`) render via `ResolvedRow`: a collapsed
card with a `StatusBadge`, quick actions ("Record PO" for `IN_PROGRESS`,
"Mark Delivered" for `PURCHASED`), and fields only ever shown inside the
form once the purchaser explicitly opens it — this is already the shape
that's wanted for post-"In progress" rows.

Changes:

- In `OpenRow` (~line 558-566), stop rendering `ProcurementEditForm`
  directly. Instead render a collapsed header matching `ResolvedRow`'s style
  (name, qty badge, a `StatusBadge` using `displayOutcome`'s "Pending", and
  the `OutcomeDropdown`). Wire the dropdown's `onChange` so that:
  - Selecting `PROCUREMENT_OUTCOME.IN_PROGRESS` calls `onResolve` directly
    with `{ outcome: IN_PROGRESS, poNumber: "", odooProductRef: "", eta: null, note: "" }`
    right away — no form, no extra click. Disable the dropdown while the
    mutation is pending (mirrors the `isPending` prop already threaded
    through).
  - Selecting any other outcome opens `ProcurementEditForm` pre-seeded with
    that outcome (same `initialOutcomeToOpen` + `isEditing` pattern
    `ResolvedRow` already uses for `handleQuickMarkPurchased`), so PO/notes
    fields show and require an explicit Save.
- Given `OpenRow` and `ResolvedRow` end up needing almost the same shape
  (collapsed card + badge + dropdown-or-quick-actions + edit-on-demand),
  consider merging them into one row component parameterized on
  outcome-or-null rather than keeping two near-duplicate components — do
  this only if it stays simple; two small components are also fine.
- No changes needed to `procurementService.resolveRequest` — it already
  accepts `IN_PROGRESS` with empty PO/eta/note (see the
  `isRevertingToInProgress` branch, ~line 573-581) exactly as this instant
  path will call it.

## Verification

- `npm test -- ProcurementPanel ProcurementResolutionPanel procurementService`
  (or the project's usual test runner) — existing suites already cover
  multi-product composing, PO-required validation per outcome, and clearing
  PO/product when reverting to "In progress"; extend them for: (a) a second
  `createRequest` to the same opportunity+assignee reuses the existing
  task's id instead of calling the task-creation RPC again, and a send after
  the task reaches `AWAITING_APPROVAL`/`COMPLETED`/`DELETED` opens a new one;
  (b) `assignRequests` does the same reuse check; (c) an unresolved request
  renders a "Pending" badge, not "Assigned"/blank; (d) picking "In progress"
  fires `resolveRequest` immediately with no form shown, picking "Purchased"
  opens the form and fields stay hidden until then.
- Manually run the dev server, open a SOR with an existing open purchasing
  requisition (or create one), send another product to the same buyer, and
  confirm it appears as a new row in the *same* task (check via "View Task"
  → the task's id should match the first send's) rather than a second task
  showing up on the buyer's task list.
- On the purchasing side, open that task and confirm: newly-assigned/unset
  items show a "Pending" badge with no fields visible; selecting "In
  progress" saves instantly and the row collapses to show "In progress" +
  "Record PO"; clicking "Record PO" (or picking "Purchased" from the
  dropdown) opens the form with PO required before Save is enabled.
