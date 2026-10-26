# ADR 0046 — On a project, the Canvass subject is the product line

## Status
Accepted (2026-11-04), spec #675, ticket #682. Narrows ADR 0034.

## Context

ADR 0034 made buying outside a project start with a Canvass against nothing,
and said a Purchase Request never starts a Canvass on its items. On a project
the product is already known: every S0 line has one Requested Item on the
project's Purchase Request (ADR 0041, #678). Since the Canvass button left the
Costing Desk's product detail, no Canvass could start on a Component, so a
winner no longer filled the matrix's Acquire cost.

## Decision

For project requests only, Purchasing starts a Canvass from the product line
(the Requested Item). Buying outside a project is unchanged: it canvasses first
on the Canvasses page.

- Starting a Canvass moves the line to Still canvassing by itself (from Not
  checked, Available, To purchase or Cannot source). Cancelled, bought and
  already-canvassing lines are left alone, and their Canvass button is off with
  the reason.
- A Canvass is never overwritten: one per line, and its Offers, winner and
  reason stay as the record of why a supplier was chosen.
- The winner's price fills the Acquire of the Component linked to the line's
  SOR line (Component, Tender Line, SOR line id). If the line links to none or
  to several Components, nothing is guessed and nothing is filled.

## Consequences

- The matrix's Acquire is fed again from the product list.
- A line that is Available can still be canvassed; the Canvass then moves it to
  Still canvassing.
