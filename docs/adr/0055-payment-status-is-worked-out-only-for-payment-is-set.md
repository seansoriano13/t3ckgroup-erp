# ADR 0055 — The Payment status is worked out from payments; only "For payment" is set by a person

## Status
Accepted (2026-11-23). Sits beside ADR 0054 and does not change it.

## Context

The General Manager (201) releases supplier payments but cannot tell from an IPAS whether it needs paying. The IPAS Status (ADR 0054) tracks where the order stands, not the money: TGIPAS_064 read Order-Draft while both of its payments, 60% and 40%, were already recorded. Purchasing kept a separate Google Sheet, the Payment Forecast, with its own status column (For payment, Pending, DP Paid, Paid, On-Hold), so the GM had a list to read.

## Decision

1. **A second status on the IPAS, the Payment status**, beside the IPAS Status and separate from it: Not due yet, For payment, DP paid, Paid. On-Hold is the IPAS's own and is not repeated.
2. **DP paid and Paid are worked out from the payments recorded**, never picked. Paid is a Remaining balance of zero (ADR 0036). DP paid is something paid with a balance left.
3. **For payment is the one step a person sets.** Purchasing asks for a payment, saying how much and what for. Recording that payment clears it. It shows while an ask is open, whatever was paid before.
4. **The Payment Forecast is the IPAS list filtered to For payment.** It is not a separate table. The GM only reads it and sees a count on the IPAS item in the sidebar.

## Considered options

- **All four steps set by hand, payments only suggest, as ADR 0054 does for the IPAS Status.** Rejected. ADR 0054 chose hand-setting because most order steps have no fact behind them. Here every step except For payment has an exact fact, so hand-setting would only let the status disagree with the payments.
- **Payment steps added to the IPAS Status list.** Rejected. Payments fall at different points of the order (a down payment before ordering, a balance before shipping or on delivery), so one line of steps cannot show both. An order can be In Transit with its balance unpaid.
- **A Payment Forecast table typed like the sheet.** Rejected. Every figure would be typed twice and drift. A purchase with no IPAS is therefore not on the forecast.

## Consequences

- An IPAS now carries three statuses (state, IPAS Status, Payment status) plus the Computation status. The Payment status earns its place because the GM reads nothing else.
- A purchase that needs paying must have an IPAS to reach the GM.
- The sheet's "Pending" becomes Not due yet, because Pending was an old IPAS Status step.
- Odoo's own bill status is not read. Paid means paid as recorded on the IPAS.

## Amendment, 2026-11-24: kept as two statuses, linked at For Payment

Re-asked whether the Payment status should fold into the IPAS Status. Kept apart: Purchasing's own notes keep a Payment Status (D.P Paid, Fully paid) in the payments section and an order list beside it, and the Payment Forecast sheet already records a row as "For payment" while its note says "Ready to ship". Changes:

- **Paid is renamed Fully paid**, the team's word.
- **The IPAS Status gains a For Payment step** (ADR 0054 amendment). Picking it opens the ask for the down payment; a balance asked later still uses the ask alone.
- **The ask carries a priority** (Very High, High, Medium), as the sheet's colours did, and may be typed as a percent of the order. The GM's list sorts by it.
- **The pill shows the split**, "DP paid · 70% paid, 30% left", so a gap in the percents is seen. No rule forces the percents to 100: the amounts are the truth.
- **Withholding (2307) is picked once on a Local IPAS** (1%, 2%, Not applicable) and shown on the Forecast, which lifts this ADR's earlier "withholding is out of scope".
