# ADR 0047 — The Contract Date is the contract's own date

## Status

Proposed 2026-10-28, from the October 2026 backlog grilling (spec #735).
**Waiting on sign-off from whoever handles commission.** Once accepted, it
replaces the part of ADR 0006 that says the Contract Date is "stamped the first
time it reaches the Won Stage". It also widens ADR 0026: a Revert now clears
the Date of Award as well.

## Context

Reaching the Won Stage stamps the Contract Date, and the Contract Date fixes an
SOR's commission rate. On the Project flow, the Won Stage is **Closed Won**,
which comes after Collection. So a Project SOR's "Contract Date" is the day the
deal closed, months after the client's PO or contract was signed. It isn't the
date on the paper.

Sales asked for the dates the paper carries: Date of Award, Date of P.O. or
Contract, Date of PDI and Date of Delivery. "Date of P.O. or Contract" is what
people already mean by Contract Date. Adding it as a second field next to the
old one would leave two "contract" dates.

## Decision

**The Contract Date is the date of the client's PO or contract.**

- Each Sales Flow names the Stage that holds the client's contract (CA / PO on
  the Project flow). The first time an SOR reaches that Stage, the Contract
  Date fills itself in, if it's still blank.
- The Deal Team may type it in earlier, while it's still blank.
- Once it's set, only a Super Admin may change it. Every change is recorded in
  History and the audit log.
- The Won Stage no longer stamps it. Every flow still names exactly one Won
  Stage, for what Won means.
- A Revert of the move that filled it in still clears it (ADR 0026).

**The Date of Award follows the same rules:** a Stage the flow names (the
Notice of Award Stage), typing while blank, a Super Admin lock, and clearing on
Revert.

Existing Contract Dates are left as they are.

## Considered options

- **Keep the Contract Date at the Won Stage, and add a separate "Date of P.O.
  or Contract".** Commission doesn't change, but there are two dates with
  "contract" in the name, and the one called Contract Date is the wrong one.
- **Rename the old field "Commission Date" and add the new one.** It's clear,
  but it keeps a date nobody uses outside commission, and commission would
  still count from Closed Won.

## Consequences

- Commission rates are picked at contract time, not at Closed Won. Deals that
  span a rate change get the rate in effect when the contract was signed.
- ADR 0006 defines Realized as "has a Contract Date". If that is still how
  Realized is worked out, deals count as booked money from CA / PO onwards.
  The ticket must check how Realized is computed today, and keep it tied to
  the Won Stage unless commission's owner agrees otherwise.
- Because Sales can now type the field, it is no longer "never manually
  editable". The Super Admin lock and the audit trail take the place of that
  guarantee.
