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

## Amendment, 2026-11-25: "For payment" is added like a payment, several at once, and leaves the IPAS Status

Ma'am Girly (201) found TGIPAS_063 reading "DP paid · 10% paid, 90% left" when nothing had been paid: with "Ask for payment" tucked in the record's More menu, Purchasing had recorded the down payment as a payment so the GM would see it. The list also showed money in two columns that looked alike (amber Payment Approval beside blue DP paid). Changes:

- **An ask is added where payments are added.** "Add payment" and "Add charge" first ask "Paid already" or "For payment (not paid yet)", with nothing picked. The More menu item goes. An open ask shows as a grey row among the payments (or charges) with "Record as paid", which opens the form filled in. A Balance ask fills in Full payment when it pays off what is left, else Payment.
- **Anything that needs paying can be asked, not only the supplier.** Down payment, Balance, or any Charge kind (freight, duties and taxes, brokerage), because the GM pays the forwarder and the customs too. A Charge's ask is in the currency it is billed in.
- **Several asks may be open at once.** One at a time would leave a duties bill off the GM's list while the supplier's balance waits.
- **Only the payment that pays an ask closes it.** "Record as paid" always does; a plain "Add payment" with an ask open asks "Does this pay the open item?", ticked. Paying less than asked still closes it; the rest is asked again. Removing that payment later does not reopen the ask; the remove confirmation says so. Replaces "any payment recorded closes the ask".
- **An ask can be edited** (amount, priority, note). No due date: the priority says how urgent.
- **Purchasing, Finance and Super Admins** ask, record, edit and remove; Super Admins gain Finance's payment rights so 201 can record a payment the moment she releases it.
- **A Payers list** in the IPAS settings (201 on it) gets a bell on each new ask and is the only one to see the sidebar count.
- **Every ask, payment and charge added, changed or removed is a Chat line** with its amounts; a change shows before → after.
- **The IPAS Status loses Payment Approval and For Payment** (amends ADR 0054). Money lives in the Payment status only; the IPAS Status tracks the goods. IPAS on either step move to Order-Draft. The two hints that suggested Payment Approval go; section 1's sign-off already shows that wait.
- **The list shows two columns that no longer look alike.** Status is the order's pill. Payment is quiet text with a small progress bar; only For payment is an amber pill, and nothing shows when nothing is due.

Rejected: a payment row with a paid/unpaid state (every total, the Landed Cost, the payment scheme, the print, the export and the filing gate would have to skip unpaid rows), and one merged status (an open ask would hide where the goods are).

## Amendment, 2026-11-27: supplier requests may be in pesos, Full payment is a purpose, and the Status chip carries the money part

Purchasing (spec #1276) found a For payment request could only be in the PO's currency, a supplier paid in one go had no fitting purpose, and the Status read "Order-Draft" after a request was saved. Changes:

- **A supplier request may be in PHP** on a foreign-currency PO (a USD | PHP switch, starting on the PO's currency). A PHP request has only a pesos box: no rate, no "% of order", no "more than the order" check.
- **Full payment is a request purpose**, next to Down payment, Balance and Charge.
- **The Status chip carries the money part.** While a supplier or charge request is open, the chip reads "Order-Draft · For payment (Down payment)", "Customs · For payment (Duties & Taxes)", or "In Transit · For payment (2)" for several. It is worked out from the IPAS figures, never stored, and goes when the request is paid or withdrawn. It shows on the record header beside the Status control and in the list's Status column.
- **The Status itself stays goods-only, as ADR 0054 says.** The Status dropdown and the Status filter keep goods steps only; "For Payment" does not come back as a step. The printed IPAS, the separate Payment pill and the Payment column are unchanged.

## Amendment, 2026-11-27 (afternoon): "For payment" is said once

The money part on the Status chip and the amber For payment chip in the Payment column said the same words twice. The team chose a hand-picked For Payment Status step instead (ADR 0054, amendment of 2026-11-27). The Status chip shows only the picked step; the Payment column and the record header show an open request as plain text: the amount and what it is for (the header adds its priority; the list has a Priority column). Not due yet, DP paid and Fully paid are unchanged.
