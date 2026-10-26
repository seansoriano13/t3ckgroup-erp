# ADR 0043 — Replace reuses the substitute link and keeps the S0 warning until Sales fixes the S0

## Status
Accepted (2026-11-04), spec #675, ticket #687.

## Context

Purchasing sometimes buys a different product from the one asked for. There is
no Substituted status any more (#676), and the old "Offer a substitute" was for
the Buyer only and said nothing about the S0 or the Canvass.

## Decision

`purchase_request_replace_item` is the one way to swap a product, in one
database call, for Purchasing only, with a required reason:

- A becomes Cancelled and keeps the reason (`replaced_reason`).
- A's open Canvass (not signed off) is stopped: `stopped_at`, `stopped_reason`
  "Stopped · replaced by B". Offers, winner and reason are never touched.
- B is a new Other request with A's quantity and unit, Not checked, linked to A
  by the existing `substitute_for_item_id`.
- If A was an S0 line, `s0_still_lists` is set and the request chat tells Sales.
  Nobody wins automatically: the S0 says what the client gets, the line says
  what was bought. The flag clears only when the S0 drops the line.
- Replace is off on Cancelled and Received lines. Purchasing is never blocked.

## Consequences

The warning holds A open in the folded list (`s0_still_lists` is one of
`NEEDS_LOOK_FLAGS`). If the client refuses B, Purchasing replaces again or
cancels. "Offer a substitute" is gone from the menu; its RPC stays in the
database for old callers.
