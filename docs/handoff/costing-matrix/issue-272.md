# #272 [OPEN] Costing settled: a Stage Condition that gates the bid

## Parent

#266 (Costing Matrix spec)

## What to build

Operations can gate the bid with a new verifiable Stage Condition kind, **Costing settled**, placed in the Flow Canvas like any other.

- **Kind:** the `stage_conditions` kind check gains `costing_settled`, with no config. `flowStageKinds` gains its label, icon and description, so the Flow Canvas picker and published versions show it (#203).
- **Evaluator:** reads the matrix through a security definer path and calls `costingMath.costingSettled`. Met when there is at least one Tender Line, every Tender Line has a Final Offer, the summary isn't incomplete, the evaluation is approved, and the Final Offer total doesn't exceed the ABC total. The failing checks are the condition's detail in the Stage checklist.
- **Live:** an edit that clears the approval, or pushes the total over ABC, makes it unmet again while the SOR is still on the Stage.
- **Bid submitted:** a move leaving a Stage through a met `costing_settled` sets `costing_matrices.bid_submitted_at` if empty. After that, a Final Offer change writes a `sales_opportunity_logs` entry on the open visit.
- **Changelog entry.**

## Acceptance criteria

- [ ] **Unit:** `costingSettled` reports each failing check alone and together; over ABC by one centavo fails; no Tender Lines fails.
- [ ] **Integration** (fake PostgREST): the condition blocks a move until the last check passes; an Offer Specification edit after approval blocks it again; a Final Offer change after `bid_submitted_at` lands on the timeline, and one before doesn't.
- [ ] The Flow Canvas picker offers "Costing settled", and a published version shows it.
- [ ] **Page test:** the Stage checklist lists which checks fail.

## Blocked by

- #270 Costing Matrix: the summary, Final Acquire and rates
- #271 Costing Matrix: Evaluation of Specification
- #203 Stage rules: condition editor rework, Stage Fields, Stage Visits, rules visible on published versions
- #204 Stage automation: task title templates, Optional Actions, Follow-up Cadence


## Comments
### seansoriano13 2026-09-17T10:45:11Z
## Amended — #316

**The condition gains one check:** the current **Bid Decision is Go** (#320).

Per [#227 amended](https://github.com/seansoriano13/t3ckgroup-erp/issues/227#issuecomment-5713001632) — the arithmetic this ticket already checks (Final Offers present, a complete summary, an approved evaluation, the offer within ABC) says the matrix is *finished*, not that the company wants to bid it. The boss's judgement is the thing that gates a bid, and it now has a record.

A Bid Decision cleared by a later price change leaves this condition unsatisfied, which is the intended behaviour: repricing reopens the decision.

This is the **only** place a Bid Decision blocks anything. No-go and Revise notify and move nothing.


### seansoriano13 2026-10-05T08:44:36Z
## Amended: prod flow scan, 2026-10-05 (#461)

- **Unmet when the SOR has no Costing Matrix.** The matrix now exists only once mounted (#462).
- **A sibling kind, "Costing priced" (#463),** covers Purchasing's half: every Component and cost-only row has an Acquire, and a Purchasing Incharge is named. Share the evaluator.
- **Publish warning:** the Flow Canvas warns when either kind sits on a stage that some path reaches without passing an "Open Costing Matrix" mount. #463 carries this.
- **The Bid Decision's Go check stands (#320).** It no longer has a no-self-approval rule; see #320's amendment.

