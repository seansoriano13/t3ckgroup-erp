# Spec: Stage Gate Engine

**Status:** ready for implementation. Synthesised 2026-08-25 from the design
session recorded in [crm-pipeline-redesign.md](./crm-pipeline-redesign.md) —
decisions D6, D18, D21, D27, D28, D31, D41, D42, D43.

**Respects:** [ADR 0004](./adr/0004-pipeline-per-deal-type.md) — a Stage belongs
to exactly one Pipeline, so requirements attach to a (Pipeline, Stage) pair.

---

## Problem Statement

Moving a Sales Opportunity Record from one Stage to the next asks nothing of
anybody. The system records that a deal is now at Notice of Award; it does not
know whether the award document exists, whether the purchasing officer was ever
assigned, or whether the ten-day statutory clock to post the Performance
Security has already run out.

The result is that work is remembered by people rather than by the system, and
three specific failures follow:

- **Deals advance without their evidence.** The Santa Lucia deal reached
  Awarded with a Notice of Award whose value differs from the quotation by
  ₱182,400, and nothing asked for the document that would have shown it.
- **Deals skip whole stretches of the process.** Seventeen recorded moves jump
  from Lead straight into the booked region, past every intervening Stage.
- **Nobody learns that a deal is late.** Under RA 12009 a winning bidder has
  ten calendar days from the Notice of Award to post the Performance Security
  and sign the Contract Agreement. Miss it and the award is forfeited. The
  system has no notion of time at all.

There is exactly one gate today — the ITB gate on For Bidding — and it is
hand-written: named columns, bespoke branches in the opportunity service, a
CHECK constraint, and a migration. Adding a second one costs the same again.
That is the real blocker, because the stated requirement is to sit with a
department head and change their stage's checklist **during the meeting**.

## Solution

A configurable Stage Gate Engine. Each (Pipeline, Stage) pair carries a list of
**Stage Requirements**; an SOR cannot leave a Stage until the required ones are
satisfied, and a Super Admin can add, edit and archive them from a settings
screen without a deploy.

Five kinds of requirement, chosen to cover what the business already does:

| Kind | Satisfied when | Example |
| --- | --- | --- |
| **Attachment** | a file of the named sort is on the record | the Notice of Award document |
| **Field** | a named SOR field is non-empty | `po_date` at PMS |
| **Tickbox** | a person self-certifies | "bid documents transmitted" |
| **Assignment** | someone from a named department is an SOR Member | the purchasing officer at Proposal Submitted |
| **Deadline** | *never blocks* — counts days and warns | ten days from Notice of Award |

A Deal Owner sees what a Stage owes before they try to move, is blocked with a
plain reason when something is missing, and sees a countdown on stages that
carry one. A department head sees their own checklist appear on the board the
day it is agreed.

## User Stories

1. As a Super Admin, I want to add a requirement to a Stage from a settings screen, so that I can agree a department's checklist in a meeting and have it live before the meeting ends.
2. As a Super Admin, I want to choose the requirement's kind from the five supported kinds, so that the system can actually check it rather than trusting a note.
3. As a Super Admin, I want to mark a requirement required or optional, so that advisory items can be tracked without blocking anybody.
4. As a Super Admin, I want to reorder the requirements on a Stage, so that the checklist reads in the order the work is actually done.
5. As a Super Admin, I want to archive a requirement rather than delete it, so that a rule that was once enforced remains visible in history.
6. As a Super Admin, I want every configuration change written to the audit log with my name and the time, so that a checklist cannot quietly disappear.
7. As a department head, I want the checklist I agreed to appear on my Stage without waiting for a release, so that my team's process is the system's process.
8. As a Deal Owner, I want to see what a Stage requires before I try to move the deal, so that I can gather the documents in one pass instead of being refused repeatedly.
9. As a Deal Owner, I want the move to be refused with the specific missing item named, so that I know what to do rather than only that I failed.
10. As a Deal Owner, I want a satisfied requirement to show who satisfied it and when, so that I can chase the right person when something stalls.
11. As a Deal Owner, I want to attach the Notice of Award and have the requirement satisfy itself, so that I am not marking my own homework.
12. As a Deal Owner, I want a requirement on a field to satisfy itself when I fill the field, so that there is one place to enter each fact.
13. As a Deal Owner, I want to tick a self-certified item and have my name recorded against it, so that the certification means something.
14. As a Deal Owner, I want to assign a purchasing officer at Proposal Submitted and have that satisfy the Stage's assignment requirement, so that the deal cannot be costed by nobody.
15. As a Deal Owner, I want a deal that jumps several Stages at once to be asked for everything it skipped, so that taking a shortcut does not silently bypass the process.
16. As a Deal Owner, I want to see a countdown on a Stage that carries a deadline, so that I know how long is left before the award is at risk.
17. As a Deal Owner, I want to be notified as a deadline approaches and again when it passes, so that a ten-day clock is not something I have to remember.
18. As a Deal Owner, I want a deadline never to block the move, so that the system does not trap a deal that is already late.
19. As a Deal Owner, I want a deal that moves backwards and returns to reuse what it already satisfied, so that a deal in trouble is not punished with duplicate work.
20. As a Deal Owner, I want requirements added after my deal passed a Stage never to apply to it retroactively, so that closed work does not reopen because of a meeting I was not in.
21. As a Purchasing head, I want to be added to an SOR automatically when it reaches Proposal Submitted, so that I see the deals my team must cost without being invited to each one.
22. As a Purchasing officer, I want to be notified when I am assigned to an SOR, so that I know a deal is waiting on me.
23. As a Purchasing officer, I want the SOR to become visible to me only once it reaches Proposal Submitted, so that I am not reading commercial detail I have no part in.
24. As a member of the bid committee, I want the documents I must collect listed on For Bidding, so that the Stage tells me what it is for.
25. As a Sales Director, I want to see which deals are blocked and on what, so that I can unblock the pipeline rather than discover it at month end.
26. As a Sales Director, I want to see which deals are past a deadline, so that I learn about a forfeited award before the client tells me.
27. As Management, I want a Stage's requirements to be the same for every deal in that Pipeline, so that the process is one process and not a per-deal negotiation.
28. As Management, I want an Outright deal never to be gated on a Bidding document, so that a dealer sale is not held up by a rule written for a government project.
29. As a Super Admin, I want no per-deal override button, so that "strict" actually means strict.
30. As a Super Admin, I want archiving a requirement to be the only escape route and for it to be logged, so that the one way out leaves a trail.
31. As an auditor, I want to see, for any deal, which requirements it satisfied and when, so that I can reconstruct what was checked.
32. As an auditor, I want a requirement that never applied to a deal to be distinguishable from one the deal failed, so that absence is not read as non-compliance.
33. As a Deal Owner, I want an Outright deal moving through Proposal Submitted to face only Outright's requirements, so that my checklist matches my process.
34. As a developer, I want the ITB gate to keep working unchanged until it is removed, so that the engine can ship without a flag day.
35. As a Deal Owner, I want the reason for a block to appear in the SOR timeline, so that the record shows why a deal sat where it did.
36. As a Deal Owner, I want a Stage's gate checklist to be separate from its Group Task, so that a short list of blocking documents is not confused with a long list of work.

## Implementation Decisions

### Where the gate lives

`opportunityService.updateStage` is the **single funnel** for Stage
transitions — `status` is written in exactly two places, and the other is
registration, which always starts at the default Stage. The gate check goes
there and nowhere else.

### Requirements attach to a (Pipeline, Stage) pair

Per D27 and ADR 0004, a Stage row belongs to exactly one Pipeline, so a
requirement referencing a Stage is already Pipeline-scoped by construction. No
separate Pipeline column is needed. `Qualified` in Bidding and `Qualified` in
Outright are different Stage rows and carry different requirements.

### Two new tables

**`stage_requirements`** — the configuration. Holds the Stage it belongs to,
the kind, a human label, whether it is required, sort order, an archive
timestamp (never a hard delete, per D21), and a small kind-specific config
object:

| Kind | Config |
| --- | --- |
| `attachment` | optional document type label |
| `field` | the SOR column name to test for non-emptiness |
| `tickbox` | none |
| `assignment` | the department that must be represented among SOR Members |
| `deadline` | days from Stage entry; whether it is measured in calendar days |

**`sor_requirement_status`** — satisfaction, keyed on (SOR, requirement).
Records who satisfied it and when. **A row's absence is meaningful** and is the
mechanism behind D41, so rows are written on satisfaction rather than
pre-created on Stage entry.

### The gate evaluates every Stage being crossed, not just the destination

This is the one decision the design session did not record, and it is
load-bearing. Seventeen production moves jump from Lead directly into the
booked region. If the gate only checked the destination Stage, a shortcut would
silently skip every requirement in between — the same hole as the Contract Date
bug, one layer up.

So a move from Stage A to Stage B evaluates the requirements of **every Stage
in `[A, B)`** — the Stage being left and every Stage passed over. This matches
how the existing ITB gate already behaves: it fires on a *crossing*, not on
occupancy, which is why deals that jumped `Lead → Awarded` carry ITB Numbers
even though no deal has ever stood in For Bidding.

Backward moves evaluate nothing.

### What "satisfied" means per kind

- **attachment** and **field** are evaluated live against the record — no
  status row is written, because the record itself is the evidence and it can
  change. A field emptied after the fact un-satisfies its requirement.
- **assignment** is evaluated live against SOR Members.
- **tickbox** writes a status row, because a self-certification has no other
  evidence and needs an author and a timestamp.
- **deadline** never gates. It is evaluated for display and notification only.

### Requirements added after a deal has crossed never apply to it

D18 and D41. A requirement is evaluated only when a deal crosses its Stage. A
deal that crossed before the requirement existed has no status row and never
acquires one — including on re-entry, per D31. Absence is the answer, not a
gap to be filled.

The consequence is accepted and is the reason retroactive compliance auditing
is foreclosed: existing deals are invisible to every requirement written from
now on.

### Re-entry reuses, never re-arms

D31. Returning to a Stage does not clear satisfaction and does not create a
second Group Task. `sor_requirement_status` is keyed on (SOR, requirement) with
no visit counter, which makes the correct behaviour the only expressible one.

### Deadlines display and notify; they never block

D42. A `deadline` requirement is a number of days from the SOR's entry into the
Stage. Entry time comes from the Stage-move entry already written to
`sales_opportunity_logs` — no new timestamp column. The board card shows the
countdown; a notification fires as the date approaches and again when it
passes, through the existing notification service.

### Overrides

None per deal (D21). The only escape is archiving the requirement, which is
Super Admin only, soft, and audit-logged. Archiving stops future evaluation and
leaves existing status rows intact.

### Coexistence with the ITB gate

D43 — the ITB gate stays live until D12 removes it. The engine runs alongside
it; both checks fire on the same transition and either can block. No migration
in this spec touches `is_itb_gate`, `itb_number` or `itb_exempt`.

### `stage_checkpoints` — a clarification this spec makes

`sales_opportunities.stage_checkpoints` is an orphan `jsonb` column on all 128
production rows, holding `[]` on every one, referenced by no code and no
migration. Q35 established it was an abandoned start on this same feature and
that D6 should "reuse the name".

**This spec interprets that as reusing the concept, and drops the column.** A
`jsonb` blob cannot be joined for "which deals owe this requirement", and the
per-requirement rows that D41's absence semantics depend on are exactly what a
table gives. Dropping it in the same migration keeps the schema honest.

*Flagged, because it narrows a recorded decision.*

### Configuration surface

A Super Admin screen under settings, alongside the existing pipeline stage
configuration. Requirements are edited per Stage. The screen is reachable and
usable on a phone, because the stated use is editing it in a meeting.

### Timeline and audit

A blocked transition writes nothing to the SOR — a block is not an event. A
*satisfied* requirement and an *archived* requirement both write timeline
entries, as does an assignment. This follows the existing convention in the
opportunity service, where stage moves and field changes are narrated into
`sales_opportunity_logs`.

## Testing Decisions

### What makes a good test here

Assert what the next person reads out of the system, not how the service got
there. A test should state a business fact — *a deal cannot leave Notice of
Award without its document* — and be readable by someone who has never seen the
implementation. No test should reference table names, query shapes, or the
order in which the service does its work.

The existing `opportunityService.test.js` is the model: it exercises public
service methods against a fake PostgREST whose schema is **parsed from the real
migrations**, with triggers hand-mirrored in `src/test/db/triggers.js`. A
mis-typed constraint name fails there the way it fails in production.

### Seam 1 — pure requirement evaluation

A pure module beside the existing Stage helpers, tested in isolation.
Prior art: `src/constants/sor.js` ↔ `sor.test.js`, and
`src/utils/commission.js` ↔ `commission.test.js`.

What is tested here:

- which Stages a given transition crosses, including multi-Stage jumps and
  backward moves
- whether a requirement is satisfied, per kind
- the distinction between *unsatisfied* and *never applied*
- deadline arithmetic — days remaining, breached, and the boundary day

These are combinatorial and cheap to pin as functions; setting up a dozen
database states to assert the same things would be slower and less legible.

### Seam 2 — services against the fake PostgREST

`opportunityService.updateStage` for the gate itself, and a new
`stageRequirementService` for configuration. Prior art:
`opportunityService.test.js`, `procurementService.test.js`,
`pipelineStageService.test.js`.

What is tested here:

- a blocked move leaves the SOR's Stage unchanged and raises a message naming
  the missing requirement
- a move blocked by a Stage that was *skipped over*, not the destination
- satisfying the last outstanding requirement unblocks the move
- a deal that re-enters a Stage is not asked again
- a requirement added after a deal crossed does not block that deal
- an archived requirement stops blocking, and existing satisfaction survives
- an Outright deal is not gated on a Bidding Stage's requirements
- the ITB gate and an engine requirement can both block the same transition
- configuration writes are refused for non-Super-Admins

Factories gain a `makeStageRequirement`; `seedPipeline` is unchanged, since
requirements default to none.

### No new seam

Both seams already exist and both are the highest available for what they
cover. Nothing in this spec needs a browser-level test.

## Out of Scope

- **The C12 trigger backstop** (D33) — ships first, separately. It is a
  migration plus one hand-mirrored entry in `src/test/db/triggers.js`.
- **The app-side half of the C12 fix** — stamping Contract Date on entry to any
  booked Stage. It belongs with the pipeline work, not the engine.
- **The migration baseline and the staging clone** (D30 steps 1–2).
- **The Pipeline split** (D1, D34) — this spec assumes one Pipeline today and
  is written so that adding more changes nothing about it.
- **Removing the ITB gate** (D12) — a later change; the engine coexists.
- **The canonical Bidding stage list** (D37) — new Stages are data, added
  separately.
- **The Sales Offer Matrix and the ILPAS sheet.**
- **Omnichannel lead intake, the Purchase Request register, and the
  post-delivery chain** (N1/N2/N3, deferred by D38).
- **Group Task auto-creation on Stage change** (L9) — a sibling of this work,
  and deliberately a separate object per D28.
- **Role sign-off as a requirement kind** — excluded by D6; it is an inbox, and
  the existing Approval Center should own it.
- **Retroactive compliance reporting** — foreclosed by D18 and D41.

## Further Notes

**Why five kinds and not more.** Each kind is something the business was
already doing by hand: attaching the award, typing the PO date, ticking off bid
documents, naming the purchasing officer, and watching a statutory clock. A
sixth kind should have to earn its place the same way.

**The deadline kind is the one with a legal source.** ITB 29.2, 29.3 and 30.1
of the Philippine Bidding Documents give a winning bidder two days to confirm
receipt of the Notice of Award and ten calendar days to post the Performance
Security and sign the Contract Agreement. Post-qualification is twelve days.
Those numbers are transcribed in
[procurement-glossary.md](./procurement-glossary.md) with page references.

**The first two requirements to configure**, once the engine is live, are the
Notice of Award attachment and `po_date` as a field requirement at PMS — the
two the design session named explicitly.

**Watch For Bidding.** D44 keeps the Stage despite it having zero recorded
transitions, on the argument that it has work which currently has no home and
that this engine is the home. If it is still empty a quarter after this ships,
that decision was wrong.

**Two sessions have been editing the design document concurrently**, and the
decision numbering collided three times. Decisions D31–D33 came from the
session reading the production transition log; the rest from the session
reading the meeting transcripts. Nothing was dropped, but a reader chasing a
decision number should check the session note at the end of the open-questions
register.
