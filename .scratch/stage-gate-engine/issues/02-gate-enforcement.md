# 2. Gate enforcement in updateStage

**Blocked by:** 1

## What works after

`opportunityService.updateStage` — the single funnel for Stage transitions —
refuses a move when any required requirement on any Stage in the crossed
range is unsatisfied, and names the specific missing item in the refusal.
The existing ITB gate keeps firing unchanged alongside it; either can block
the same transition.

## Scope

- Call the ticket-1 evaluation module from `updateStage`, evaluating every
  Stage in `[from, to)` per the spec's load-bearing decision — not just the
  destination Stage.
- A blocked move leaves `status` unchanged and raises an error naming the
  missing requirement(s). Per the spec: **a blocked transition writes
  nothing to the SOR** — a block is not a timeline event.
- An Outright-vs-Bidding distinction is not needed here — the spec assumes
  one Pipeline, so this ticket does not add Pipeline-awareness. (Once the
  Pipeline split ships, this call site inherits it the same way every other
  `stages`-consuming call site does — no change to this ticket's contract.)
- No per-deal override exists or is added (D21) — archiving on the config
  side (ticket 3) is the only escape route.
- Coexist with the ITB gate exactly as today: both checks run on the same
  transition, unchanged, no migration here touches `is_itb_gate`,
  `itb_number`, or `itb_exempt` (D43).
- Re-entry to a Stage does not re-ask what was already satisfied (D31) —
  this ticket's job is just to make sure `updateStage` asks the evaluation
  module rather than re-deriving the answer itself.

## Out of scope here

- Where satisfaction actually gets recorded (attachment upload, field fill,
  tickbox, assignment) — ticket 5.
- Surfacing the checklist to a Deal Owner before they try to move — ticket 6.

## Testing

Seam 2, against the fake PostgREST. Prior art: `opportunityService.test.js`.

- a blocked move leaves the SOR's Stage unchanged and raises a message
  naming the missing requirement
- a move blocked by a Stage that was skipped over, not the destination
- satisfying the last outstanding requirement unblocks the move
- a deal that re-enters a Stage is not asked again
- a requirement added after a deal crossed does not block that deal
- an archived requirement stops blocking, existing satisfaction survives
- the ITB gate and an engine requirement can both block the same transition
