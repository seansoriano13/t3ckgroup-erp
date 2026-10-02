# Order Income is read from the Income Note, never derived

The Retail screen totals Order Income: what Shopee or Lazada actually pays out per Retail Order. Odoo holds no field for it, only the Order Amount, which is the product's list price (sometimes typed lower) and not what the buyer paid. Sales hand-types each order's Marketplace Fee and Order Income from the Marketplace's own breakdown into an Income Note (an Odoo To-Do). So we read Order Income from that note as typed. We never compute it as Order Amount − Marketplace Fee, and a missing value stays Missing Income. It is never back-filled with Order Amount.

## Considered Options

- **Order Amount − Marketplace Fee.** Rejected. A full-history audit (2026-10-02, 1,505 orders) found Fee + Income equals Order Amount on only 75% of Shopee and 43% of Lazada orders. That's because buyer vouchers and Marketplace deductions never reach Odoo. Deriving it would be wrong on a quarter to half of orders.
- **Flag every order where Fee + Income ≠ Order Amount.** Rejected for the same reason: it would mark a quarter to half of all orders as wrong when most are fine. Only Suspect Income is flagged: Income above Order Amount, or Fee at least Order Amount. Either one means the note belongs to another order.
- **Fall back to Order Amount when the note has no income.** Rejected. It would quietly bring back the overstatement this replaces.
- **Import the Marketplace's own income export.** Deferred, not rejected. It is the only real way to verify the figures. The Marketplace Order ID is stored now so that import can later be matched by it.

## Consequences

- Order Income covers about 80% of orders. The rest are Missing Income, shown on screen so they can be chased with the salesperson, not hidden.
- One known template period (Shopee, Oct 2025–Mar 2026) typed the income under "TOTAL BUYER AMOUNT". That value counts as Order Income only where Fee + it equals Order Amount exactly.
