# ADR 0054 — The IPAS Status is set by hand; facts only suggest

## Status
Accepted (2026-11-20). Replaces the worked-out six-step IPAS Status (spec #595, #597), the buyer track and the Supplier Origin dates. Amends ADR 0036.

## Context

Since spec #595 the IPAS Status (Pending, Requested, Ongoing, Paid, Done) was worked out from the IPAS and never stored, and the order's movement was spread over two more trackers: the seven-tick buyer track and the four Supplier Origin dates. Purchasing gave us their own list of where an order stands (Order-Draft through Out for Delivery), most of whose steps (Processing, In Transit, Customs, Arrived at Local Hub, Out for Delivery) no record in the ERP or Odoo knows. The team said they prefer to change the status themselves.

## Decision

1. **One status, the team's list, set by hand.** Order-Draft, Payment Approval, Ordered, Processing / Preparing Shipment, Shipped / Picked Up, In Transit, Customs / Port Hold, Arrived at Local Hub, Out for Delivery, Delivered, Done. A Local purchase has no Customs, Local Hub or Out for Delivery. It replaces the six-step status, the buyer track and the Supplier Origin dates.
2. **Facts suggest, never move.** When the IPAS knows a fact that matches a step (raised, section 1 sent, the Odoo PO confirmed, goods received), it offers that step in one click. The status never changes without a person.
3. **Done is the one exception.** Only Filing sets it and only Reopen takes it away, so nobody can call an unfiled order done.
4. **Last picked, not furthest.** Any step, forward or back, skips allowed. Each step keeps the date it was reached (today unless moved earlier, never later), which is what the Ageing rules count from.
5. **Not an SOR Stage.** The boss expects these steps on the SOR pipeline one day. They stay the IPAS's own (ADR 0023, 0033: one SOR has many IPAS and one IPAS names several SORs). The SOR reads them on its IPAS summary; a Stage Condition can gate on them later.

## Considered options

- **Worked out from facts, as before.** Rejected: most of the steps have no fact behind them, and a status that half-moves by itself and half waits for a person is harder to trust than one that always waits for a person.
- **Moves forward on its own when a fact proves a later step.** Rejected for now: it would overwrite what the team picked, which is the control they asked to keep.
- **A separate Shipping status beside the old one.** Rejected: one IPAS would carry four statuses (state, IPAS Status, Shipping status, Computation status).

## Consequences

- **The status can lag the facts.** That is accepted; the suggestion is how the facts get in front of the person. Do not "fix" it by auto-applying the suggestion.
- **The Remaining balance no longer reads the status.** "Paid" is gone, so ADR 0036's zero now comes from a full payment being recorded or the IPAS being filed.
- **The buyer track's back-office ticks (With P.O.P, Received in Odoo, Create Bill, Actual Checking) stay as plain facts** on the record and in Order Monitoring's next thing after Delivered, with no Ageing rules of their own.
- **Existing IPAS get a starting status worked out once** at switch-over (Shipped Out → Shipped / Picked Up, Onboard → In Transit, Arrived in PH → Customs / Port Hold, Arrived in Whs → Delivered, filed → Done), and their Ageing rules carry over where a step maps (Purchase Order → Ordered, Import Clearance → Customs / Port Hold, Delivered → Delivered).

## Amendment, 2026-11-22: one dropdown, the Chat is the history

The step list in 4 · Delivery is retired. The status is one dropdown on the record's Status pill: a pick saves at once and no day is asked (the database still dates the step, today or the day a step already had when going back, so the ageing rules keep counting). "Edit date" is gone. Every change of the status, however it happens (the dropdown, Filing, Reopen, a source change to Local, a cancel), is posted in the IPAS's Chat as a `status_changed` event line by the database (`20261222100000_ipas_status_change_in_chat`); event lines notify nobody. Facts still only suggest: the suggestion shows under the pills and as a hint in the dropdown.
