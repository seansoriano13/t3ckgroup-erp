# 6. Deal Owner visibility

**Blocked by:** 2

## What works after

A Deal Owner sees what a Stage owes before they try to move — gathering
documents in one pass instead of being refused repeatedly — and, if a move
is refused, sees the specific missing item rather than a bare failure. A
Sales Director can see which deals are blocked and on what, across the
register.

## Scope

- Pre-move checklist: on an SOR's detail view, show the requirements
  attached to the deal's current Stage (and, once ticket 5 lands, whether
  each is satisfied and by whom/when — this ticket can ship first with a
  static list and gain the live status as 5 lands, since they touch
  different surfaces).
- Blocked-move UX: surface `updateStage`'s refusal (ticket 2) as a specific,
  named reason in the move UI, not a generic error.
- Sales Director view: which deals are currently blocked and on what — a
  register-level read, not a new page if an existing dashboard/register
  view can carry it.
- A bid-committee-facing list of what For Bidding collects (story 24) is
  the same pre-move checklist rendered on that Stage — no separate feature.

## Out of scope here

- Writing satisfaction (ticket 5).
- Deadline countdowns specifically (ticket 7) — this ticket's "what's
  missing" view does not need to render deadline state, since deadlines
  never block and have their own display surface.

## Testing

Component-level for the checklist and blocked-message rendering, against
whatever `updateStage` (ticket 2) already returns — no new service-layer
test seam needed here.
