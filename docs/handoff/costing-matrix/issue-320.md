# #320 [OPEN] Bid Decision: the boss decides whether this price wins this project

## Parent

#316

## Depends on

- #270 — the summary, Final Acquire and rates (the Final Acquire list lives here)
- #272 — the "Costing settled" condition kind
- #319 — Closed Book (the decision's numbers sit inside it)

## Problem Statement

The meeting surfaced what the Costing Matrix is actually **for**: the boss decides whether the price fits the government client's published budget, and whether the project is worth taking at that price. Nothing in the specs records that judgement.

The closest things are Final Acquire — a number, not a verdict — and the "Costing settled" condition, which checks arithmetic. So the most consequential decision in the commercial process happens in a conversation and leaves no trace of who took it, when, or against which figures.

The go/no-go **Project Evaluation** was deliberately retired (#210), and this is not its return: that judged whether a deal was worth chasing *before* anything was costed. This judges one priced offer.

## Solution

### The record

A **Bid Decision** on a Costing Matrix: **Go**, **No-go** or **Revise**, with the reason in the decider's own words.

Stamped at the moment it is taken with:
- the **Final Offer total** it was taken against
- the **ABC** it was taken against
- who decided, and when

Those stamped figures are part of the **Closed Book** (#319).

### Who decides

The existing **Final Acquire list** (#270) — Super Admins maintain it, no self-approval. Deliberately not a second list: it would hold the same names and drift.

### What clears it

**Any later change to a Final Offer or a Final Acquire clears the Bid Decision**, recording that it was cleared and why. A Go always refers to numbers that still stand. Same pattern as an evaluation edit clearing "Evaluation approved" (#271).

### What it does

- **Go** satisfies the new check in "Costing settled" (#272). That is the only place a Bid Decision blocks anything.
- **No-go records and notifies the Deal Team, and moves nothing.** PMS never moves the deal (#227) — taking the SOR to Closed Lost stays the Deal Owner's move on the Sales Flow.
- **Revise** is No-go's sibling: it says reprice, and clears nothing on its own.

### What Sales sees

**The verdict and the reason, never the numbers** it was taken against (#319). *"No-go — offer is ₱400k over ABC and we can't get there"* gives the Deal Team everything they need to act on without a single figure.

### Where it appears

- On the Costing Matrix, at the summary.
- Pending decisions in the **Approval Center**, for the Final Acquire list, following the existing queue pattern.
- On the printed money sheet (#274), which is Closed Book.

## Acceptance criteria

- [ ] A Bid Decision records verdict, reason, decider, timestamp, and the Final Offer total and ABC at that moment.
- [ ] Only a Super Admin or a member of the Final Acquire list can take one; nobody can decide on a matrix they are the sole decider of and also authored — no self-approval.
- [ ] Changing any Final Offer or Final Acquire clears an existing Bid Decision and records the clearing.
- [ ] "Costing settled" (#272) is unsatisfied unless the current Bid Decision is Go.
- [ ] No-go and Revise notify the Deal Team and change no stage, no status and no flag on the SOR.
- [ ] A Deal Team member sees the verdict and reason and no stamped figures.
- [ ] Pending decisions appear in the Approval Center for the list.

## Domain

**Bid Decision**, **Closed Book**, **Final Acquire** in `CONTEXT.md`. See [#227 amended](https://github.com/seansoriano13/t3ckgroup-erp/issues/227#issuecomment-5713001632).


## Comments
### seansoriano13 2026-10-05T08:44:44Z
## Amended: prod flow scan, 2026-10-05 (#461)

**The no-self-approval criterion is dropped for the Bid Decision.**

- **Why:** the Final Acquire list starts as 101 alone (#470). 101 sets Final Acquire and decides the bid, so "nobody can decide on a matrix they are the sole decider of and also authored" would refuse every decision.
- **The reasoning:** the Bid Decision is the boss's own judgement on the boss's own numbers, not a sign-off on someone else's work.
- **The others keep theirs:** the IPAS, the Canvass and the Evaluation still forbid self-approval (`CONTEXT.md` **Bid Decision**).

Acceptance criterion 2 now reads: *Only a Super Admin or a member of the Final Acquire list can take one.*

