# Built in #320 (commits c0b2e70c, a8a3d06c)

- Migration `20261018170000_costing_bid_decision.sql`: costing_bid_decisions (one live per matrix, live = cleared_at null; verdict go/no_go/revise, reason, decided_by, decided_at, final_offer_total, abc_total (null if any line lacks ABC), cleared_at, cleared_reason). Written only by functions.
- `costing_decide_bid(matrix, verdict, reason)`: Super Admin or final_acquire list; refused until every Tender Line has a Final Offer; new decision clears the live one ("Decided again").
- Clearing triggers: Final Offer, Final Acquire (components, cost rows), Tender Line quantity. History records decision + clearing.
- No-go / Revise notify the Deal Team (minus decider), type SOR_BID_DECISION, no figures. Go notifies nobody.
- Tiers: price (Deal Team / Always sees) → verdict, reason, decider, date; closed_book → all incl. stamped totals; cost/participant → nothing.
- Service: decideBid, pendingBidDecisions, shapeBidDecision; get returns bidDecision, bidDecisionHistory per tier.
- UI: BidDecisionPanel.jsx under the summary; Approval Center queue `/approvals/bid-decisions` (nav for Super Admin + Final Acquire list). employeeService reads isFinalAcquire at login; getPermissionContext adds isBidDecider.
- For #272: the live verdict is costing_bid_decisions where cleared_at is null.
