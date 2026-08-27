# 5. Per-kind satisfaction wiring

**Blocked by:** 2

## What works after

Attaching the Notice of Award satisfies its own requirement without a
separate "mark done" step. Filling `po_date` satisfies the PMS field
requirement the moment it's saved. Ticking a self-certified item records
the ticking user's name and the time. Assigning a purchasing officer at
Proposal Submitted satisfies that Stage's assignment requirement. A
satisfied requirement, and an archived one, both narrate into the SOR
timeline the way stage moves and field changes already do.

## Scope

- **attachment** — the existing attachment-upload path evaluates live
  against records on file; no separate satisfaction action, no status row.
  A requirement can carry an optional document-type label to match against.
- **field** — the existing field-save path (e.g. `po_date` at PMS)
  evaluates live against the named column; emptying the field un-satisfies
  it (spec is explicit this must not be cached).
- **tickbox** — a UI action that writes a `sor_requirement_status` row with
  the ticking user and timestamp. This is the one kind with no other
  evidence, so the row **is** the certification (story 13).
- **assignment** — evaluated live against SOR Members; assigning a member
  from the named department satisfies it, with no separate action beyond
  the existing assignment flow (story 14).
- Timeline entries: a satisfied requirement and an archived requirement
  each write a `sales_opportunity_logs` entry, following the existing
  narration convention. A *blocked* move still writes nothing (that's
  ticket 2's rule, unchanged here).
- Story 10 — a satisfied requirement shows who satisfied it and when
  (attachment/field/assignment resolve this from the record/member itself;
  tickbox resolves it from the status row).

## Out of scope here

- The pre-move "what does this Stage owe" view and the blocked-reason
  message (ticket 6) — this ticket is the write path, not the read path.

## Testing

Seam 2, against the fake PostgREST, extending the existing attachment /
field-save / assignment test suites rather than inventing new ones — each
kind's satisfaction is asserted through the flow that already exercises
that write (uploading an attachment, saving a field, assigning a member),
plus the tickbox action's own new test.
