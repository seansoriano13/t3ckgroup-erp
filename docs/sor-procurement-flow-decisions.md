# SOR → Purchasing procurement flow — decision record

**Status:** decisions from the design session of 2026-08-17. Not a plan. No code
written. Expect revisions — this document exists so the next round of input can
be diffed against what was already settled rather than re-litigated from scratch.

**Scenario being designed:** a SOR is registered with a product list. Some
products do not exist in Odoo, so sales cannot finish the quotation. Sales
mentions purchasing, which generates a task carrying those products as a
checklist. Purchasing sources them, creates the product in Odoo, raises a PO,
and records the result. Sales is notified and finishes the quotation.

---

## Decided

### 1. Trigger and completion

The flow triggers on **"this product does not exist in Odoo"** — not on "out of
stock". Sales ops makes that determination by eye; nothing checks the Odoo
catalog automatically (`odoo-sor-lookup` searches `sale.order` by S-number, not
`product.template`, so an automatic check means a new edge function and an
invocation per SOR view).

Purchasing's real-world sequence is: buy from supplier → create the product in
Odoo → raise the PO. Because a PO cannot exist before the product record does,
**the PO number is the single completion fact** — it proves both that the buy
happened and that the product is now quotable. Confirmed with purchasing: a PO
is always raised for these.

### 2. Where procurement state lives

A **new table**, not a column on `sales_opportunity_items`.

`opportunityService.replaceItems` deletes every item row and re-inserts with
fresh UUIDs on every SOR save (`src/services/opportunityService.js:393`). Line
items have no stable identity, so any state stored on them is destroyed the next
time anyone edits the SOR — silently.

Each request row:

- has its own `id`
- freezes `requested_name` — the free text sales typed, never updated afterwards
- carries `odoo_product_ref`, filled by purchasing at completion
- carries the PO number **per row** (see 4)
- carries an optional ETA (see 6)

Matching a row back to a SOR line is by normalised name, for **display only**,
and a miss is tolerated. Freezing the request is correct on its own terms: a
requisition should record what was asked for at the time, not mutate when
someone fixes a typo weeks later.

### 3. How a request is raised

**Flagged items create the task; the mention only decides who owns it.**

- Each SOR product line shows an in-Odoo / not-in-Odoo state.
- A mention with **zero** flagged items is a comment and a notification only —
  no task. This is what prevents task-list bloat.
- A mention with N flagged items creates **one** task with N checklist rows.
  Never one task per mention.

Mentioning a **named purchasing employee** assigns them. Mentioning the
**department** routes to the purchasing head, who assigns
(`notificationService.notifyHeadByDepartment` already exists;
`allow_reported_to_reassignment` is already a setting). Random assignment was
rejected: it ignores leave, load, and supplier relationships, and arbitrary
assignment attached to an HR-graded record invites gaming. If zero-human routing
is ever wanted, use least-loaded, not random.

### 4. Task shape

A regular `tasks` row. One owner, `checklist` jsonb for the products,
`reported_to` = purchasing head.

**No group task.** The existing practice — purchasing head creates a group task
containing all three department members, one person does the work, the group
task never closes — is diffusion of responsibility, and the group task is the
thing causing it. Completion requiring all members to act is why those rows sit
open forever. One `tasks` row with one named owner, visible to the whole
department on the board.

PO number lives on the **item row**, not the task: one PO per supplier is the
norm, so a three-item request routinely spans two POs. A single task-level field
would force the purchaser to pick one and hide the other. The exception costs
nothing — one PO covering three items is just the same number on three rows.

### 5. Title convention

`[PR] S01237 — ACME Corp — 3 items to source` in `task_description`, with
`project_title` set to the SOR's own `project_title` so it groups with the deal.

`PR` = Purchase Requisition, the standard term across SAP, Oracle and NetSuite
for the internal request to buy — distinct from the PO that follows. Odoo calls
a draft `purchase.order` an RFQ and numbers it `P0####` once confirmed, so `[PR]`
reads unambiguously against it. The S-number leads because it is the only
cross-system key, and approvals search is a substring match over description
(`src/pages/approvals/tasks/index.jsx:290`).

### 6. Per-item outcomes

**No new task status.** `TASK_STATUS` is untouched. Outcomes are a column on the
request rows:

| Outcome | Meaning |
| --- | --- |
| `ON_ORDER` | PO raised, product now exists in Odoo, goods not yet on hand |
| `ALREADY_EXISTS` | Already in Odoo under a different name — no purchase needed |
| `SUBSTITUTED` | Different product sourced; sales must re-price |
| `UNAVAILABLE` | Cannot be sourced |

Plus a `PENDING_VERIFICATION` mark when the Odoo check soft-fails (see 7).

`ON_ORDER` rather than `SOURCED`: the goods routinely are not on hand when the
PO is raised, and `SOURCED` reads as finished. A `RECEIVED` state would require
Odoo stock reads that do not exist today — explicitly out of scope, not
forgotten.

The task closes normally as `COMPLETED` once every row is resolved. Per-item
outcomes exist because partial results are the normal case: a purchaser who
sources two of three would otherwise have to either mark done (a lie sales acts
on) or leave it open (invisible work, bad grade).

`ALREADY_EXISTS` matters more than it looks — sales types "Boom Lift 12m", Odoo
has "BOOM LIFT, 12M, DIESEL". Purchasing can clear a flag without buying
anything. Without it they either buy a duplicate or close the item dishonestly.
**Open question: how often this happens** — see below.

Each row also takes an **optional ETA**, filled at completion. Lead time
"depends on the product" per purchasing, and that variance is the argument for
capturing it: a 3-day item and a 12-week item are otherwise indistinguishable,
and sales is quoting a delivery date off it.

### 7. Odoo verification

The PO number is validated against Odoo — a new edge function searching
`purchase.order` by name, confirming it exists and returning what it references.
This fires once per **completed item**, not per page view: tens of invocations a
month, which is cost-noise at this volume.

**Soft-fail.** If Odoo is unreachable the number is accepted and marked
`PENDING_VERIFICATION`. Nobody's task completion blocks on an integration
hiccup.

### 8. Approval chain

Normal, unmodified: purchaser marks done → purchasing head approves
(`reported_to`) → HR verifies.

Self-approval was rejected. The entire reason this becomes a task is so HR can
evaluate it; a self-approved task carrying a self-entered PO number contains no
independent check at all. Head approval is one click.

### 9. Notifications and routing

Sales' notification lands on the **SOR**, not on purchasing's task — their next
action is finishing the quotation, which happens on the opportunity.

Types take the `OPPORTUNITY_` prefix the router already handles:
`OPPORTUNITY_PROCUREMENT_REQUESTED`, `OPPORTUNITY_PROCUREMENT_RESOLVED`.

**Deliberately avoiding the substring `TASK`** — the router's fallthrough is
`notif.type.includes("TASK")` (`src/utils/notificationRouter.js:63`), so a type
named `PROCUREMENT_TASK_DONE` would be silently captured by task routing.
Purchasing's own notification, which does point at their task, keeps it.

### 10. Permissions and visibility

Purchasing gets write access **scoped to the procurement rows only**. They can
never edit the parent SOR.

`sor_can_edit_opportunity()`
(`supabase/migrations/0003_sales_opportunity_items.sql:78`) grants write to the
registrant, the four sales participants, heads and super admins — a purchasing
employee is none of these and would be blocked from writing the PO number back.
The new table needs its own policy, not a reuse of that helper. (RLS is
currently enabled only on the three SOR tables; `tasks` has no policies in any
migration.)

**The S01237 quotation PDF is not attached.** It carries customer-facing pricing
and therefore the margin on a live deal. Purchasing needs product names,
quantities and specs — all already in the checklist. If specs are needed, attach
a spec sheet.

### 11. Consequences

- **Unsourceable items stay in the product list and stay in `expected_value`.**
  The SOR shows a warning naming the amount; sales removes, substitutes, or
  knowingly keeps it. Auto-removing rewrites someone's forecast behind their back
  and deletes the record of what the client asked for; auto-excluding makes the
  displayed total stop matching the lines beneath it. `expected_value` is
  trigger-maintained as the sum of all items
  (`supabase/migrations/0003_sales_opportunity_items.sql:60`).
- **An open request warns at the stage gate, it does not block.** Blocking makes
  purchasing's backlog into sales' blocker, and the predictable response is
  deleting the flagged line, advancing, and re-adding it — a gate that teaches
  people to route around it.
- **A SOR closed lost with an open request notifies the purchaser and posts a
  system note on the task, but never auto-closes it.** Real money may already be
  committed to a supplier, and a task that silently vanishes takes the evidence
  of that spend with it.

---

## Open

- **How often does sales name a product that already exists in Odoo under a
  different name?** Purchasing has not answered. Not blocking — `ALREADY_EXISTS`
  covers it either way — but it decides whether that path is the main UI route
  or a dropdown entry.
- Purchasing said the product record is created by them *"usually"*. If another
  team sometimes does it, there is a handoff mid-task that is currently not
  modelled. Low risk: the task stays owned by purchasing regardless, who report
  the result.

## Raised in passing — backlog, not this scope

- ~~**Restore the `QUALIFIED` opportunity stage.**~~ **Done 2026-08-17.** It had
  been removed in commit `4ae5a5f` (2026-08-13) and was a two-line frontend
  restore in `src/constants/sor.js` — no migration, since the DB `CHECK` still
  permitted the value and `OPPORTUNITY_STATUS_THEME` still mapped it
  (`src/constants/status.js:40`). Everything downstream derives from
  `OPPORTUNITY_STAGES`, so the board, matrix, personal overview, details-modal
  stepper and stage filter all picked it up. Rows already sitting at `QUALIFIED`
  had been rendering a blank stage label and now render correctly.
  `requiresSalesReference` now gates `LEAD → QUALIFIED` on an S-number, matching
  the rule that a quotation is what qualifies a lead (`src/constants/sor.js:67`).
- **Expected value display.** Proposal was two numbers — deal owner's manual
  input above, product-line total below. Assessment: two figures both labelled
  expected revenue, differing constantly because nobody fills the manual one,
  creates a "which is real?" question every time. Better shape: one number, made
  explainable — expandable to the line items with unsourceable amounts called
  out (which is also the fix for the warning in §11). Manual override renders
  only when actually set, and then visibly wins and shows the delta.
- **Group task grading**: switch from per-member to per-committee-task grading.
  Per-member grading is reportedly unused today.
- **YouTube link per product** — explicitly descoped, not deferred. A link is a
  property of the product, not of a deal, so it cannot live on the SOR line
  (`replaceItems` destroys it, and it would be re-entered per deal). If revived:
  a local `product_media` table keyed on the Odoo product ref, since the Odoo
  integration is read-only and adding `product.template` writes is a much larger
  blast radius.

## Handled outside this record

- **Migration ordering** — done. New table and column adds follow the 0015/0016
  pattern: schema first, run manually before deploy, backfill after.
- **Supabase cost** — being solved separately. For reference, this flow adds
  Odoo calls only at item completion; the SOR product list adds none, since the
  flag is a local column.
