# ADR 0045 — The P0's price is the Actual cost, kept on the Component's costs row

## Status
Accepted (2026-11-04), spec #675, ticket #686.

## Context

Costing wants Expected (what a Canvass winner promised) and Actual (what the
P0 says) side by side. The attached P0 is read from Odoo when it is attached
(ADR 0044 area, #684). The Requested Item is read by every requester, so a
price must not be stored on it.

## Decision

- Expected is the Component's Acquire, which a Canvass winner already fills (#278).
- Actual is `costing_component_costs.p0_unit_price`, registered in
  `costing_column_tiers` (cost, closed_book) and `costing_column_bands`
  (purchasing) like Acquire, so tiers that may not read costs do not get it.
- The `odoo-po-verify` edge function, after attaching a P0, calls the
  server-only `costing_set_p0_price` with the P0 line's `price_unit`. The
  database refuses anyone but Purchasing and does nothing for a line with no Component.
- The matrix reads "Expected X · Actual Y (+n%)" when they differ, one figure
  when they match, and "X (Canvass winner)" before a P0 is attached. Acquire
  itself is never overwritten, so a typed figure is not lost; the Actual is
  what the text puts first.

## Consequences

A P0 whose price changes in Odoo is picked up the next time it is attached
or refreshed; it is not polled. The product line's own text (without money for
people who may not see costs) is left to the screen ticket.

## Amendment: a foreign P0 (2026-10-26)

Odoo's `price_unit` is in the P0's own currency, and Acquire is in pesos, so a
USD P0 read as pesos ("Expected ₱24,641.49 · Actual ₱388.00 (−98.4%)" for
P01235). Now `odoo-po-verify` sends the P0's `currency_id` with the price, and
`costing_set_p0_price` keeps both as quoted (`p0_quoted_unit_price`,
`p0_currency`) and stores `p0_unit_price` in pesos:

- a PHP P0: the price as quoted;
- a foreign P0: times the comparison rate of the Component's Canvass winner,
  when the winner is in the same currency. That is the rate that turned the
  winning Offer into Acquire, so Expected and Actual differ by price only;
- otherwise (no winner in that currency, or Odoo did not say the currency):
  null. The matrix shows the price in its own currency, not compared, and the
  totals keep Acquire.

Not the Reference Rate: it only pre-fills an Offer's comparison rate. Not the
rate paid: at Attach P0 there is usually no IPAS payment yet, and the rate
paid is Landed Cost's (still provisional; its full computation is on the
roadmap). A winner changed after the P0 is attached is picked up the next time
the P0 is attached, as a changed price is.
