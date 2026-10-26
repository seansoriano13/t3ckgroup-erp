# ADR 0050 — A bought Other request merges onto the new S0 line, by one database call

## Status
Accepted (2026-11-05), spec #675, ticket #688.

## Context

An Other request is a product Sales asked for in words. Purchasing may buy it
(a P0 is attached) before the product is on the S0. When Sales later adds the
product to the S0, the project's product list would show it twice: the S0 line
at Not checked, and the Other request with the P0.

## Decision

- When an S0 line's Requested Item is made, the database checks the project's
  Other requests once. If one with purpose "For the client" and a P0 attached
  (not Cancelled) bought the same Odoo product, the S0 line is marked
  `new_on_s0` and points at the request (`yours_item_id`). The screen shows
  "Is this yours?" and holds the line open in the folded list until it is
  answered.
- The Odoo product of the P0 line is stored as `bought_product_id` when a P0
  is attached (beside `bought_as`), because the match is by product, not by name.
- `purchase_request_answer_yours(item, same)` is the only way to answer, and only
  Purchasing or the sales side may. No clears the question and changes nothing
  else. Yes, in one call: the P0, its delivery facts and status move onto the S0
  line, the request's chat history, Canvass and price follow, and the Other
  request becomes Cancelled with "Closed · {P0} and its delivery moved onto {S0
  line}". Nothing is deleted.
- Materials for the job are never asked about: they never join the S0.

## Consequences

The question is asked only for a new S0 line, not when a P0 is attached after
the S0 line exists. A line that was answered No is not asked again. The merged
S0 line reaches the Costing Matrix like any S0 line, because its Component
already follows the line's fixed id.
