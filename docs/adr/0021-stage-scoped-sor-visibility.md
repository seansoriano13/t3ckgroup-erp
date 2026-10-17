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
- **A Mention grants nothing.** *(Reversed for note mentions on 2026-10-01; see Amendments.)*
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

From #377 / #382 and the go-live grilling session, ahead of the 2026-10-01
production cutover. Reverses #330's "Legacy Pipeline gets no Always sees".

Legacy Pipeline's Always sees and Always edits are both **Everyone**, set by
the cutover backfill. Every employee reads, edits and moves Legacy Pipeline
SORs as they do on production today. Government and Outright stay private to
their Deal Team.

**Every employee always sees Legacy Pipeline SORs.** This decision's private
model applies to the Sales Flows built for it, Government and Outright, and not
to the 252 SORs production registered before Sales Flows existed. Always sees
gains an "Everyone" selector for this, set on Legacy Pipeline's Flow Canvas
settings, so the rule is visible where every other access rule is.

This reverses the #330 cutover note that Legacy Pipeline gets no Always sees.
Measured on production, that note would leave 23 of 37 active
non-Super-Admin employees with an empty register, including the whole of
Operations and most of Admin. Those staff read and work every SOR today. It
would also stop Admin moving a legacy SOR's Stage, because
`sor_guard_stage_move` requires full access. Taking away access staff rely on,
mid-project and on go-live day, was the larger risk. The legacy SORs carry no
Stage Visit history worth isolating, and Legacy Pipeline has no Restricted
Stages.

Government and Outright keep this decision unchanged: Deal Team and Super
Admins by default, and anything wider is configured on their Flow Canvas.

Editing follows the same line. Production lets any employee edit any SOR
today, while this decision limits editing to the Deal Team, heads and Super
Admins. For Legacy Pipeline, a per-flow **Always edits** list sits beside
Always sees on the Flow Canvas, set to Everyone, so staff keep editing the
projects they are mid-way through. Government and Outright leave it empty.
It is a flow setting rather than a Legacy-only exception in the policy, so
flows built later can use it too.

### 2026-10-01 — a note Mention is an invitation and grants read-only access

Decided by the product owner while fixing mentions on old SORs, where a person
was notified about a deal they could not open.

"A Mention grants nothing" no longer holds for a Mention in an SOR's notes, on
any SOR (Stage-scoped or old). The mention roster offers every employee, every
live Mention is notified, and it records a row in `sor_mention_viewers`
(`sor_grant_mention_view`, callable by anyone with full or participant access
to that SOR). `sor_access_level` reads that row as `participant`, so the person
opens the money-free `sor_participant_record`, and the SOR appears under My SORs
as "Mentioned by ...". Someone who already reaches the SOR (Deal Team, Always
sees, Super Admin) gets no row.

Why: being named in a note is the sender's choice to pull that person in, and a
notification that opens nothing is worse than either outcome. Allowing the
click was cheaper than gating who can be mentioned.

What does not change: a Mention opens **no Stage Visit data**. Tasks, logs and
Stage Fields stay behind `sor_visible_visit_ids`, so Restricted Stages stay shut
and a mentioned person sees the record header, not the Stage's work. Expected
Value and commission stay Deal Team only. A Mention in a group task or task chat
is unrelated and still grants nothing beyond that task.

The grant is permanent; there is no revoke. If that proves too loose, the
natural next step is closing it with the Stage like a Stage Participant window.

### 2026-10-07 — a note Mention opens the current Stage Visit until it is left

Decided by the product owner after a purchasing employee, mentioned on an SOR,
opened it to an empty timeline and no explanation. Replaces the 2026-10-01
amendment's "a Mention opens no Stage Visit data" and its permanent grant.

A Mention in an SOR's notes opens a **Mention Window** on the Stage Visit the
SOR is on at that moment: its notes, tasks, Stage Fields and attachments, to
read and reply to. Expected Value and commission stay Deal Team only. When the
SOR leaves that visit the window closes and the person drops to `locked`,
keeping a read-only look at the visit they were mentioned in. A Mention on a
later visit opens another window. An SOR with no Stage Visit keeps the
2026-10-01 behaviour: the record header, permanently. Grants made before this
amendment are tied to the visit the SOR was on when they were made.

Two deliberate relaxations, because the business is not yet ready for the
strict form and asked to be able to restore it quickly:

- A Mention Window opens **even on a Restricted Stage**.
- **Anyone inside a Mention Window can mention others in**, so invitations chain.

Both strict forms are kept in the code, commented, under a `TIGHTEN(mention)`
marker. `grep -rn "TIGHTEN(mention)" supabase src` finds every place to change.

The silences are closed in the UI too: someone with no access sees a
prohibited screen naming the Deal Owner to ask, partial access carries a banner
and a placeholder for each Stage hidden from them, the composer says when a
Mention will open a window, the SOR lists who it is shared with, and My SORs
tags windows that have ended.

### 2026-10-17 — the Costing Matrix's money read is split by side (Closed Book)

From [Closed Book: the database serves each side its own columns](https://github.com/seansoriano13/t3ckgroup-erp/issues/319),
amended on 2026-10-05 for Always sees (#461). **Replaces the money-read rule in
the 2026-09-15 amendment above**, which let Purchasing access, Finance access
and the Final Acquire list read the whole matrix on every SOR. It no longer
holds: that reading is what made the margin visible to anyone on the deal.

The caller's tier is resolved in the database (`costing_tier`), never passed in,
first match wins:

1. **Closed Book** — a Super Admin, or on the Final Acquire list: every column,
   the markup factor, the summary and the Bid Decision's stamped figures.
2. **Purchasing access** — the cost side: Acquire, Odoo unit, ABC. No Final
   Offer, no Final Acquire, no markup factor, no summary, no Bid Decision.
3. **Deal Team or Always sees** — the price side: ABC, the peso Markup Price,
   Final Offer, Compliance, and a Bid Decision's verdict and reason. No Acquire,
   no factor, no Final Acquire, no Marketing or OPEX, no stamped bid figures.
4. **Stage Participant with an open window** — the matrix without money.
5. **Anyone else, Finance access alone included** — nothing. Finance gets Landed
   Cost and the IPAS, not the matrix.

A column a tier may not read is absent from the response, not null, in both the
matrix read and the history. The money tables and the event history can be
selected directly by Closed Book only. The write bands in the 2026-09-15
amendment's source (#225) are unchanged. Everyone else called into an SOR still
sees the matrix without money, as that amendment said.

### 2026-10-18 — Costing conditions keep peso figures in the database (#266 review)

Code review of the Costing Matrix (#266) found three ways the Closed Book
could be read around, and fixed them:

- **The over-ABC and missing-cost checks are computed in SQL**
  (`costing_bid_totals`, `costing_condition_inputs`, `costing_settled_met`), so
  no peso figure leaves the database. `costingMath` then turns the booleans and
  counts into the verdict (`costingSettled`, `costingPriced`). That is the one
  deliberate second implementation of the rule: SQL decides from the figures,
  JavaScript decides from the booleans, and both must agree (policy 86 and the
  unit tests hold them to it).
- **Who sees the reasons.** The price and Closed Book tiers get the full
  evidence (`bid_verdict`, `over_abc`, the counts). Everyone else who can see
  the SOR gets only the server's `settled_met` for Costing settled, so the
  Stage checklist says "Costing not settled" and nothing about the Bid Decision
  or the offer against the ABC. Costing priced counts hold no money and go to
  all of them.
- **A cost-only row's Markup Price** is not served to the price tier: with no
  factor of its own it is Acquire x1.00, which is Purchasing's cost to the
  centavo.

Also: `costing_mark_bid_submitted` checks for itself that the Stage just left
carries an active Costing settled condition and that it is met, and the legacy
`sor_inclusions` backfill into a matrix is removed (a matrix exists only once
Open Costing Matrix runs). The PMS tab shows for everyone who can see the SOR
(Finance reads the IPAS there); only its Costing Matrix section needs a tier.
