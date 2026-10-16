# #268 [OPEN] Costing Matrix: Components, bundles, Inclusions and cost-only rows

## Parent

#266 (Costing Matrix spec)

## What to build

Sales and Purchasing cost each Tender Line with Components, bundles with unpriced Inclusions, and cost-only rows — each writing only their own columns — and old SOR inclusion lists move in.

- **Schema:** `costing_components`, `costing_component_costs` (acquire_unit, odoo_unit, final_acquire_unit, markup_factor; this ticket's screen writes Acquire and Odoo only), `costing_inclusions` (under a bundle only), `costing_cost_rows`.
- **Band trigger extended:** Brand, Status, Odoo unit → Sales; P.O./RFQ No., availability, Source, Acquire, Offer Specification → Purchasing; adding and removing Components, Inclusions and cost-only rows → Sales or Purchasing; Super Admin passes these.
- **Incharge:** the matrix's Sales and Purchasing incharge with row overrides; a trigger checks a Sales incharge is on the Deal Team and a Purchasing incharge has Purchasing access. It grants nothing and notifies nobody.
- **`costingMath.lineTotals`** gains Acquire and Odoo totals (null when any is blank); cost-only rows stay out of line totals.
- **Service:** `addComponent`, `updateComponent`, `removeComponent`, `addInclusion`, `updateInclusion`, `moveInclusion` (via `costing_move_inclusion`, refusing a non-bundle), `addCostRow`, `updateCostRow`, `removeCostRow`, `setIncharge`.
- **Grid:** Components nested as 1.1, 1.2; Inclusions collapsible under bundles with their headings; cost-only rows beneath; the owner-band header; cells outside the viewer's band read-only; refusals shown inline.
- **Migration:** `sor_inclusions` rows move under an "Unplaced inclusions" Tender Line and bundle Component per SOR, keeping Completeness, with `cost_amount` recorded in the event detail. The old table becomes read-only. The hidden Inclusions panel is removed from the SOR.
- **Changelog entry.**

## Acceptance criteria

- [ ] **Unit:** a bundle at 1 × ₱2,160,500 totals ₱2,160,500; a blank Acquire on any Component leaves the line's Acquire total null, never zero.
- [ ] **Policy tier:** Sales refused Acquire; Purchasing refused Brand; Super Admin allowed both; a participant refused `costing_component_costs` and `costing_cost_rows`; an Inclusion under a non-bundle refused; a Sales incharge off the Deal Team refused.
- [ ] The `sor_inclusions` move matches literal fixtures.
- [ ] **Service test:** `moveInclusion` places an unplaced Inclusion under a bundle.

## Blocked by

- #267 Costing Matrix: Tender Lines on the SOR's PMS page


## Comments
### seansoriano13 2026-09-17T10:44:50Z
## Amended — #316

**A Component gains an Odoo product id** (#318), for the same reason a Requested Item does: it is what shows stock, and what later lets Landed Cost find its way back to the row (#283). A Requested Item added from a Component (#273) carries the link across.

Everything else here stands — Components, bundles, unpriced Inclusions, cost-only rows.

Note that **#319 (Closed Book)** governs which of this ticket's cost columns each reader receives. Build them together.

