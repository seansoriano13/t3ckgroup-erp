# #463 [OPEN] Costing priced: a condition that Purchasing has costed every row

## Parent

#461 (Q11, Q18, Q19). ADR 0033.

## Depends on

- **#268:** Components, cost-only rows and Acquire.
- **#462:** Open Costing Matrix.
- **#272:** the "Costing settled" evaluator, which this shares.

## Problem Statement

Prod's Government flow has a **PMS Sourcing GS** stage whose only test is a required link to the costing Google Sheet. That field retires when the Costing Matrix ships (Q1), which leaves the stage with no exit test. Sales cannot set a Final Offer against a blank Markup Price, and Markup Price stays blank until Purchasing has proposed an Acquire. The hand-off from Purchasing to Sales therefore needs its own check, separate from "Costing settled", which also needs Final Offers, the evaluation, ABC and the Bid Decision.

## Solution

### The condition

A new verifiable Stage Condition kind, **Costing priced** (`costing_priced`). It is met when all of these hold:

- the SOR has a Costing Matrix
- the matrix has at least one Component
- every Component and every cost-only row has an Acquire unit cost
- a Purchasing Incharge is named on the matrix

Inclusions are unpriced and don't count.

It **re-evaluates live**, as Costing settled does. Clearing an Acquire after the SOR left the stage changes nothing retroactively, but a revert back to the stage re-checks it.

### Publish warning

The Flow Canvas warns at publish when **Costing priced** or **Costing settled** sits on a stage that some path from the flow's entry reaches without passing a stage that mounts Open Costing Matrix. This is a warning, not a refusal.

## Acceptance criteria

- [ ] `stage_conditions` accepts `costing_priced`; the condition picker lists it.
- [ ] Unmet with no matrix, with no Component, with any Component or cost-only row lacking Acquire, or with no Purchasing Incharge; met otherwise.
- [ ] Shares the matrix arithmetic module with Costing settled. One implementation, no second copy.
- [ ] Publishing a flow where a costing condition is reachable without an earlier Open Costing Matrix shows the warning and still publishes.
- [ ] Unit tests over the evaluator; one integration test moving an SOR out of a stage gated by it.

## Domain

**Costing Matrix**, **Component**, **Incharge** in `CONTEXT.md`; ADR 0033.


## Comments

