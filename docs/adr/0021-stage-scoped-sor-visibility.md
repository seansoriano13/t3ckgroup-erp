# ADR 0021 — SOR visibility is scoped to Stage Visits and enforced by the database

## Status

Accepted 2026-09-14, from the CRM grilling session. Narrows the SOR read rules
introduced by `20260908101315_server_side_sor_task_visibility.sql` (#129–#131).

## Context

The CRM now crosses departments. A Stage Action pulls a purchaser, an engineer,
or a finance officer into one Stage of one SOR, and the business wants each of
them to see that Stage's work and nothing else — not the Stages before they were
called, not the ones after they finished. It also wants the reverse: some
Stages are closed to some of the Deal Team, including Deal Owners.

Today's SOR read rule is role-based: registrar, Deal Owner, Support Sales 1 and
2, Sales Director, every head, every HR employee, and Super Admins see the whole
record; everyone else sees none of it. So an employee called in by a Stage
Action cannot open the SOR at all, and the heads and HR can open every SOR
whether or not they have a part in it.

The Commission feature hides peer figures in the UI only (ADR 0002). Doing the
same here was the cheaper option.

## Decision

**Access to an SOR's data is decided per Stage Visit, and the database decides
it.** Reads that fall outside a person's access are refused by row-level
policy, not hidden by the screen.

- **Deal Team** (registrar, Deal Owner, Closing Salesperson, Support Sales 1
  and 2, Sales Director) see every Stage Visit except on a Restricted Stage
  their role or an excluded Employee Group is shut out of. Super Admins are
  never shut out.
- **Stage Participants** see the Stage Visits inside their access window. The
  window opens when a task-creating Stage Action, an Assignment condition, or a
  Purchase Request (for its purchasing members) calls them in, and closes when
  the calling Stage is left, when a chosen later Stage is entered or left, or at
  a Terminal Stage. A Terminal Stage always closes it.
- **Outside their access**, people get a locked summary (Sales Reference,
  project, current Stage) from a function, plus a read-only look at the visits
  they worked on.
- **Heads and HR lose automatic access.** A Sales Flow names who always sees
  its SORs.
- **A Mention grants nothing.**
- **Expected Value and commission stay Deal Team only**, even inside a Stage
  Participant's window.

## Considered options

- **UI-only masking, as in ADR 0002.** Rejected. A called-in employee cannot read
  the SOR today, so UI masking would first have to open the database to them.
  Everything the screen then hid would be one API call away, and "pure
  isolation" was the requirement.
- **Access per Stage rather than per Stage Visit.** Rejected. Flows loop, so an
  SOR can return to a Stage. Per-Stage access would re-open an earlier visit to
  whoever is called into a later one, which is the leak the business described.
- **Restricted Stages by role only.** Rejected. The business needs to shut out
  specific Deal Owners, not every Deal Owner, so an excluded Employee Group sits
  beside the role list.

## Consequences

- **Stage Visits become a recorded fact**, written by the database when an SOR
  moves, because every access check reads them.
- **Every SOR child table needs a visit-aware read policy**: the timeline,
  attachments, condition status, Stage Field values, members, line items, and
  the tasks and Group Tasks Stage Actions create.
- **Task policies have to close first.** As of this ADR, `tasks` and
  `task_activity` are readable without signing in, and production's
  `committee_tasks` is readable by every signed-in employee. Action-created
  tasks carry the Sales Reference and Company in their text, so stage isolation
  means nothing until those policies are narrowed.
- **Attachments are Cloudinary URLs.** The database can withhold a link, but
  it cannot revoke a link someone has already seen.
- **The register pays for it.** Listing SORs now runs a visit check per row, so
  the locked summary has to stay cheap. Visibility gets policy tests against
  real Postgres, not the in-memory fake.
- **Reversing it is expensive.** Collapsing back to role-based reads means
  choosing who loses isolation, after the business has come to rely on it.

## Amendments

### 2026-09-15 — the Costing Matrix shows its offer outside the Deal Team

From [Costing Matrix column ownership and who sees the numbers](https://github.com/seansoriano13/t3ckgroup-erp/issues/225).

"Expected Value and commission stay Deal Team only" holds for the SOR itself.
It does not hold for one SOR's Costing Matrix: **Purchasing access, Finance
access and the Final Acquire list read the whole matrix on every SOR** — costs,
markups, Final Offer, the achieved markup, the quotation price shown beside
Final Offer, and the summary — whether or not they are Stage Participants there.
Final Offer's total is the bid, so this does reveal what the SOR is worth.

Why the exception is deliberate: the Costing Matrix is one grid that Sales,
Purchasing and Management write to in different columns, Markup Price is a
suggested selling price in Purchasing's own band, and Finance's OPEX sheet takes
its Revenue from the matrix. Commission is unaffected and stays hidden from all
three.

Everyone else called into an SOR — Technical evaluating specifications, the
Warehouse, Logistics — sees the Costing Matrix **without money**, inside their
window, which is the rule this ADR already sets for line-item prices.

### 2026-09-25 — Legacy Pipeline is open to Everyone

From #377 / #382. Reverses #330's "Legacy Pipeline gets no Always sees".

Legacy Pipeline's Always sees and Always edits are both **Everyone**, set by
the cutover backfill. Every employee reads, edits and moves Legacy Pipeline
SORs as they do on production today. Government and Outright stay private to
their Deal Team.
