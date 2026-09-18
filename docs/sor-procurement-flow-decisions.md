# SOR → Purchasing procurement flow — decision record

**Status:** decisions from the design session of 2026-08-17, **implemented the
same day, reworked 2026-08-18** after the premise behind §1–3 turned out to be
wrong (see "Revision" below). Expect further revisions — this document exists
so the next round of input can be diffed against what was already settled
rather than re-litigated from scratch.

## Migrations — all applied and archived

0017–0023 shipped long ago. They were folded into the baseline
(`supabase/migrations/20260904000000_baseline_schema.sql`, ADR 0011) and the
files now live under `supabase/migrations/_archive/`. **Do not run them by
hand** — migrations reach staging via `.github/workflows/migrate-staging.yml`
on push and production via a manually triggered `migrate-prod.yml` (AGENTS.md,
"Database migrations"). What each one established:

| # | What it established |
| --- | --- |
| 0017 | `sor_procurement_requests` + RLS |
| 0018 | `sor_raise_procurement_task` SECURITY DEFINER insert |
| 0019 | Widened the outcome CHECK to the 3-step lifecycle |
| 0020 | Realtime on `sor_procurement_requests` |
| 0021 | Realtime on `sales_opportunity_logs` |
| 0022 | Added `odoo_vendor` |
| 0023 | Column guard trigger on the update policy |

0017 was revised in place after the rework (free text + images replaced the
flagged-line shape) rather than split into a second file.

**Where it lives:**

| Piece | File |
| --- | --- |
| Table + RLS | `supabase/migrations/_archive/0017_sor_procurement_requests.sql` |
| Task insert (RLS workaround) | `supabase/migrations/_archive/0018_sor_raise_procurement_task.sql` |
| Outcome lifecycle constraint | `supabase/migrations/_archive/0019_sor_procurement_lifecycle_statuses.sql` |
| Realtime publications | `supabase/migrations/_archive/0020_…_realtime.sql`, `0021_…_realtime.sql` |
| PO vendor column | `supabase/migrations/_archive/0022_sor_procurement_odoo_vendor.sql` |
| Who may write purchasing's columns | `supabase/migrations/_archive/0023_sor_procurement_column_guard.sql` |
| Outcomes, PO format, title builder | `src/constants/procurement.js` |
| Badge palette (shared leaf) | `src/constants/statusTheme.js` |
| Flow logic | `src/services/purchasingService.js` |
| Task-deletion guard (leaf, breaks the cycle) | `src/services/procurementTaskLinks.js` |
| PO verification | `supabase/functions/odoo-po-verify/index.ts` |
| @ mentions in Log Notes | `src/components/ui/MentionTextarea.jsx`, `src/utils/mentions.js` |
| Sales-side request UI | `src/components/sor/PurchasingPanel.jsx` |
| Purchasing-side resolution UI | `src/components/ProcurementResolutionPanel.jsx` |
| Recorded PO / vendor / ETA block (shared) | `src/components/ProcurementMetaFooter.jsx` |

**Scenario being designed:** a client asks sales for a product the company
doesn't carry. Sales names it for purchasing — a name, whatever the client said
about it, usually a screenshot of the message they said it in. Purchasing
sources it, creates the product in Odoo, raises a PO, and records the result.
Sales is notified and finishes the quotation.

---

## Revision — the original premise was wrong

The first build had sales **flag existing lines on the SOR product list** as
"not in Odoo," with a per-line Odoo/not-Odoo indicator. That's impossible by
construction: the SOR's product list is *pulled from* the Odoo sales order
(`odoo-sor-lookup` reads `sale.order.line`), so every line on it already exists
in Odoo. The set of "flagged, not-in-Odoo SOR lines" is always empty. What
actually happens is a client asks for something that was **never on the
order** — sales requests it as a new product, and there is nothing to flag on
the SOR at all.

This killed §1–3 of the original decisions and everything downstream of them:

- The per-line Odoo/not-Odoo column on the SOR product list is **gone**.
  `ItemsList` is back to a plain product table.
- The "unsourceable value" banner and `unsourceableValue()` helper are **gone**.
  A requested product was never a SOR line item and never contributed to
  `expected_value`, so nothing was ever inflated — there was nothing to warn
  about.
- Requests are **free text**, not a tick-list over existing lines:
  `requested_name`, `requested_description`, `requested_images` (Cloudinary
  descriptors, same shape as every other attachment column in this schema).
  No `requested_value` — a product nobody carries has no price to quote yet,
  which is exactly what purchasing is being asked to find out.
- The composer stays **collapsed behind a button** rather than always-open next
  to the product list, since it is no longer a property of that list.

Everything from §4 onward (task shape, title convention, outcomes, PO
verification, approval chain, notification routing, permissions, the
closed-lost hook) survived unchanged — none of it depended on the flagging
premise.

### UI rework, same pass

Prompted separately, alongside the premise fix:

- The composer is a **button-revealed form**, not an always-visible checklist —
  most opportunities never need one, and a permanently open form made every
  record look like it had outstanding work on it.
- Product name is a **borderless headline**, not a bordered input: it's free
  text with nothing to validate against (there is no catalog holding this
  product yet — that's the entire reason for the request), so a boxed field
  would imply a check that can't exist.
- Unit picking uses the existing `Dropdown` (`src/components/ui/Dropdown.jsx`);
  buyer/team picking uses `FilterTrigger`/`FilterOptionList`
  (`src/components/ui/FilterDropdown.jsx`) — both reused rather than
  reinvented, matching the rest of the app's pickers.
- Description accepts a **pasted screenshot** directly
  (`useFileAttachments().addFromPaste`), because sales rarely retypes specs —
  they paste the screenshot of the client's message. Images upload to
  Cloudinary only on send, never on paste, so an abandoned draft costs nothing.
- The SOR product list's cell padding went from `px-3 py-2` to `px-4 py-3` —
  called out as too tight once the dead Odoo column was removed and there was
  room to fix it.

### 1–3. Superseded — see Revision above

### 3. How a request is raised (current)

**A named product creates the task; the mention only decides who owns it.**

- The composer holds up to 3 products per send, each with its own name,
  quantity, unit, description and up to 5 images.
- Submitting with **no named product** does nothing — no task, no request.
  This is what prevents task-list bloat: an empty send is a no-op, not a
  comment recorded anywhere.
- A send with N named products creates **one** task with N checklist rows.
  Never one task per product.

Mentioning a **named purchasing employee** assigns them. Mentioning a **team**
(department, or department › sub-department where one exists — see §3a) routes
to that team's head, who assigns
(`notificationService.notifyHeadByDepartment` already exists;
`allow_reported_to_reassignment` is already a setting). Random assignment was
rejected: it ignores leave, load, and supplier relationships, and arbitrary
assignment attached to an HR-graded record invites gaming. If zero-human
routing is ever wanted, use least-loaded, not random.

### 3a. Teams, not departments

Purchasing turned out to be **`OPERATIONS › PURCHASING`**, a sub-department —
not its own top-level department. This broke the first cut of team-mention
routing twice, in testing against the real org:

- Offering bare departments in the picker made "mention OPERATIONS" resolve to
  the Operations Manager (`notifyHeadByDepartment` matches a department-level
  head only when that head has **no** sub-department). The picker now offers
  every distinct `department` / `department › sub-department` pair as one
  "team," 21 of them in the live data, `OPERATIONS › PURCHASING` among them.
- The naive fix — passing department **and** sub-department together — matches
  *both* branches of that function's filter, so the Purchasing Manager and the
  Operations Manager both get notified on every request. Fixed by passing only
  the narrower of the two: sub-department when there is one, department
  otherwise (a team with no sub-department, e.g. `SALES`, still resolves
  correctly).

Both were caught by deliberately mutating the code back to each broken version
and confirming the test suite fails — see `purchasingService.test.js` and
`PurchasingPanel.test.jsx`, which fixture the real shape (`OPERATIONS` with
its own head, `PURCHASING` nested under it with theirs) rather than a flattened
one, so re-flattening it later re-breaks the test instead of the routing.

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

> **Superseded in part.** The table below is the 2026-08-17 vocabulary.
> `ON_ORDER` was renamed `PURCHASED` and `IN_PROGRESS` / `DELIVERED` were added
> — see "Built beyond this record" at the end of this document. The live set is
> `src/constants/procurement.js` (`PROCUREMENT_OUTCOME`); `ON_ORDER` survives
> only in `LEGACY_PROCUREMENT_OUTCOME` for rows already carrying it.

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

`ALREADY_EXISTS` matters more than it looks — sales asks for "Boom Lift 12m",
Odoo already carries it as "BOOM LIFT, 12M, DIESEL" under a name sales didn't
know to search for. Purchasing resolves the request as a name mismatch without
buying anything. Without this outcome they either buy a duplicate or close the
request dishonestly. **Open question: how often this happens** — see below.

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

### 9a. Inserting the purchasing task

`tasks` has RLS enabled but **no policy defined anywhere in this repo** — it was
created through the dashboard. A requisition task is owned by the buyer
(`logged_by` = the purchasing employee) while the person clicking Send is in
sales, which that policy rejects: *new row violates row-level security policy
for table "tasks"*.

Fixed with a `SECURITY DEFINER` function, `sor_raise_procurement_task`
(migration 0018), rather than by touching policies:

- **Not a rewritten policy.** Dropping and recreating a policy that cannot be
  read first is guessing at the access rules of the app's core table, and a
  wrong guess silently breaks task logging for everyone.
- **Not an additional permissive policy.** Nothing on the row marks it as a
  requisition at insert time, so a policy permissive enough to cover this case
  would have to allow inserting a task for an arbitrary employee.

The function is gated on `sor_can_edit_opportunity()` — the same permission
that already governs the `sor_procurement_requests` rows the task exists to
carry, so the two halves of a request cannot come apart. `EXECUTE` is revoked
from `public` and granted to `authenticated`.

Because the insert no longer goes through `taskMutationService.createTask`,
`purchasingService.openTaskFor` posts the system activity entry and the
`TASK_ASSIGNED` / `NEW_TASK_SUBMITTED` notifications itself — otherwise the
task would appear with no trail and nobody would be told it exists.

### 9b. Mentions in Log Notes

Separate from the procurement recipient field: `@` in the note composer offers
people, and posting notifies whoever was named.

- Mentions are stored as **ids alongside the text** (`metadata.mentions`), not
  parsed back out of it on save. A name typed by hand, or edited after picking,
  would otherwise notify nobody — and a notification that only sometimes fires
  is worse than one that never does.
- A mention whose name is **no longer in the posted text** is dropped. Picking
  someone then deleting the name is a change of mind.
- **Mentioning yourself notifies nobody.** Writing your own name is a note to
  self.
- Type is `OPPORTUNITY_MENTION` — the `OPPORTUNITY_` prefix routes to the deal,
  and it deliberately avoids the substring `TASK` for the reason in §9.

Only names actually recorded on the note are highlighted when it renders, so a
hand-typed `@someone` reads as plain text — honest, because nobody was pinged.

### 10. Permissions and visibility

Purchasing gets write access **scoped to the procurement rows only**. They can
never edit the parent SOR.

`sor_can_edit_opportunity()`
(`supabase/migrations/_archive/0003_sales_opportunity_items.sql:78`) grants write to the
registrant, the four sales participants, heads and super admins — a purchasing
employee is none of these and would be blocked from writing the PO number back.
The new table needs its own policy, not a reuse of that helper. (RLS is
currently enabled only on the three SOR tables; `tasks` has no policies in any
migration.)

**The S01237 quotation PDF is not attached.** It carries customer-facing pricing
and therefore the margin on a live deal. Purchasing needs product names,
quantities and specs — the request's own name, description and screenshots
already carry that, since sales forwards the client's own wording rather than
retyping it. Nobody needs the priced quotation to source a part.

### 11. Consequences

- **An open request warns at the stage gate, it does not block.** Blocking makes
  purchasing's backlog into sales' blocker — the deal can't move even though
  the requested product has nothing to do with what's already quoted. The
  predictable response to a hard block is finding a way around it, e.g.
  withdrawing the request just to advance the stage — a gate that teaches
  people to route around it rather than one that informs the decision.
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

---

## Built beyond this record — noted 2026-08-18 during review

A two-axis review of the working tree against this document found behaviour in
the code that the record never asked for. None of it is being reverted; it is
recorded here so the record and the build agree, and so the next reader does
not have to guess which of the two was ahead.

- **`DELIVERED` outcome and the `ON_ORDER` → `PURCHASED` rename** (§6 said a
  received state was "explicitly out of scope, not forgotten"). What was out of
  scope was *inferring* receipt from Odoo stock reads, which still is. This is
  a purchaser ticking a box they already know the answer to, so the objection
  did not apply. `ON_ORDER` stays legal in the CHECK (0019) and readable in the
  app for rows already carrying it, but it is **not** a member of
  `PROCUREMENT_OUTCOME` — an alias inside the enum made `Object.values` return
  `PURCHASED` twice and `ON_ORDER` never, which is a trap for anything building
  a dropdown or a tally off it. `LEGACY_PROCUREMENT_OUTCOME` holds it instead.
- **Auto-submitting the task once every row is delivered** (§8 has the
  purchaser mark done). Kept: the last delivery *is* the purchaser saying so,
  and making them then find the task and click Submit is a second statement of
  the same fact. The approval chain itself is unchanged — the head still
  approves.
- **`[PR #N]` batch numbering** (§5 fixes one title form). Needed once a second
  requisition can exist on one deal, which §1 of the follow-up plan introduced.
  Note the trap it created: `TaskDetails` gated the whole resolution panel on
  `startsWith("[PR]")`, which `"[PR #2]"` fails — every second-batch task
  rendered as an ordinary task with no panel and no Submit button. Both the
  predicate and the batch parse now live in `constants/procurement.js`
  (`isRequisitionTitle`, `requisitionBatchNumber`) so there is one spelling.
- **Store-letterhead quotation PDF** (`src/lib/pdfLetterhead.js`,
  `quotationService`). Unrelated to procurement; rode along in the same working
  tree. Belongs in its own commit and its own record.
- **`input.jsx` rewrite, `textarea.jsx` ring, `index.css` reformat and the
  global `prefers-reduced-motion` block.** Design-system work, same situation.
- **Recall / `end_at` fix and the procurement-linked task delete guard.** The
  delete guard is genuinely part of this flow (§11 only covered closed-lost);
  it now lives in `src/services/procurementTaskLinks.js` rather than inside the
  generic task service, which had no business knowing this table exists.

### Two corrections to what §1 of the follow-up plan asked for

The plan said task reuse should filter `status = INCOMPLETE`, and should
**skip** restating the task's item count. The build did neither. Both are now
as the plan wrote them, because the plan's reasons were the right ones:

- Reusing an `AWAITING APPROVAL` task pulled it back out of the head's approval
  queue on a sales action. A submitted task is a closed cycle; a later send
  opens a fresh one.
- Restating the count meant a direct `.update()` on `tasks` from a sales user —
  the same RLS wall 0018 exists to route around, and it was issued with no
  error check, so a rejection would have failed silently. The activity entry
  already records that more was added.
