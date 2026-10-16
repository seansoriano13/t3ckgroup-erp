# #267 [OPEN] Costing Matrix: Tender Lines on the SOR's PMS page

## Parent

#266 (Costing Matrix spec)

## What to build

Every SOR gets a PMS tab holding its Costing Matrix, and Sales can add Tender Lines with ABC and Final Offer — with the money tier enforced by the database from the first table.

- **Schema:** `costing_matrices` (one per SOR, created by trigger at registration, backfilled), `costing_matrix_money`, `costing_tender_lines`, `costing_tender_line_prices`, `costing_events` (trigger-written, append-only), and `costing_signer_lists` (empty; seeded by later tickets).
- **Access helpers:** `costing_can_read_money(opp)` and `costing_can_read(opp)` as the spec defines them. Non-money tables need `costing_can_read`; price tables and money events need `costing_can_read_money`.
- **Band trigger** for these tables: Tender Lines, their ABC and Final Offer are Sales band (Deal Team); Super Admin passes. A refusal names the column and band.
- **Tender Lines:** typed (multi-line specification, unit, quantity, ABC unit) or picked from an SOR line (snapshot `{ name, quantity, unit }`, stock from #202, "SOR line now says …" when it differs); Final Offer typed; the quotation price beside Final Offer when different; reorder and remove; numbered 1, 2, ….
- **`costingMath`** starts here: `lineTotals` for ABC and Final Offer totals and the over-ABC flag.
- **`costingMatrixService`:** `get` (money keys absent, not null, for a participant), `addTenderLine`, `addTenderLineFromSorLine`, `updateTenderLine`, `removeTenderLine`, `reorder`, `history`.
- **The PMS tab** in the SOR modal, shown when `costing_can_read`. It also takes over the IPAS summary (#249, #265) and the Transmittals and Packing Lists section (#257), unchanged. The locked view shows no PMS.
- **Changelog entry.**

## Acceptance criteria

- [ ] A newly registered SOR has a matrix; the migration gives every existing SOR one.
- [ ] A Tender Line picked from an SOR line keeps its snapshot after `updateOpportunity` replaces the lines, and shows "SOR line now says …".
- [ ] A Tender Line over its ABC is flagged, and the matrix shows Final Offer as a percentage of ABC.
- [ ] **Policy tier:** a Stage Participant with an open window reads Tender Lines but is refused `costing_tender_line_prices` and money events; Purchasing access, Finance access and a `final_acquire` list member read prices on an SOR they have no part in; a plain employee reads nothing; a purchaser outside the Deal Team is refused writing Final Offer; events can't be updated or deleted.
- [ ] **Service test** (fake PostgREST): `get` for a participant has no money keys.
- [ ] **Page test:** the PMS tab renders the matrix and the moved IPAS and Transmittal sections.

## Blocked by

- #202 Stock Availability: Odoo free stock on SOR line items
- #207 SOR modal: organised around the current Stage Visit (Now, Journey, Items, Details, chat column)
- #208 Stage-scoped SOR visibility: Deal Team, Stage Participants, Restricted Stages (ADR 0021)
- #249 IPAS: summary on the SOR
- #257 SOR shows its Transmittals and Packing Lists
- #265 Order Monitoring: where an SOR's own orders stand


## Comments
### seansoriano13 2026-10-05T08:44:35Z
## Amended: prod flow scan, 2026-10-05 (#461)

The PMS page stays from registration, but **its Costing Matrix section renders only once the SOR's Costing Matrix exists**, and "Open Costing Matrix" (#462) creates it. Until then the page shows its other sections and no empty grid. Build the page so that this state is normal, not an error.

