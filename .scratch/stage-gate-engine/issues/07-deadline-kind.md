# 7. Deadline kind — countdown + notifications

**Blocked by:** 1

## What works after

A Stage carrying a `deadline` requirement shows a countdown on its board
card, a notification fires as the date approaches and again once it passes,
and none of this ever blocks a move — a deal that is already late is not
additionally trapped.

## Scope

- Board card countdown, reading the deadline arithmetic from ticket 1's
  pure module (days remaining / breached / boundary day), computed off the
  Stage-entry timestamp already written to `sales_opportunity_logs` — no
  new timestamp column.
- Notification on approach and again on breach, through the existing
  notification service. The two statutory examples to configure once this
  ships: ten calendar days from Notice of Award, twelve days for
  post-qualification (see `docs/procurement-glossary.md` for the ITB
  clause references) — configuring them is a ticket-3/4 config action, not
  new code here.
- Sales Director view of which deals are past a deadline (story 26) — can
  share the register-level surface from ticket 6 if that's already built,
  otherwise a small addition to it.
- Confirm explicitly in tests that a breached deadline never blocks
  `updateStage` (ticket 2's suite already covers this by omission, but this
  ticket's own suite should assert it directly rather than relying on an
  absence).

## Out of scope here

- Everything about the four blocking kinds — tickets 2, 5.

## Testing

Deadline arithmetic itself is Seam 1 (ticket 1's module: days remaining,
breached, the boundary day). This ticket's own tests cover the countdown
render, the notification firing at approach/breach, and the direct
assertion that a `deadline` requirement never appears in a blocked-move
reason.
