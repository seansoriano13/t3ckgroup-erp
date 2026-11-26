# ADR 0056 — The OPEX Report's Product cost is Odoo's pesos, not the Landed Cost

## Status
Accepted (2026-11-26), grilled with the maintainer on the S06637 sheet.

## Context

Each project's Google Sheet had an OPEX report whose product cost was a hand-worked
Landed Cost per item: the price plus freight, duties and fees spread over the items. The
ERP now has an OPEX Report per S0 that reads Odoo by Project tag, and it also has a Landed
Cost on each IPAS. The obvious choice would be to use that Landed Cost.

## Decision

Product cost on an OPEX Report is Odoo's pesos for each P0 line that counts for the S0:
the bill, or the ordered amount while the line is not billed yet. Shipping and import
costs count separately, as Odoo expenses under the Project tag or as Typed costs that
Finance adds with a note. The IPAS Landed Cost is not read.

Why:

- **Nothing is counted twice.** Freight sits inside an IPAS Landed Cost, and the same
  freight is often booked in Odoo as a tagged Delivery expense too. With Landed Cost,
  one payment would count both ways.
- **It works for every project.** The ERP's first IPAS is from 2026-11-17, and
  S06637's P0s have none. Odoo has bills for all of them. Odoo itself holds only
  30 landed-cost records.
- **The report stays on its own.** It needs only Odoo and the S0 number, as agreed.

## Consequences

Import costs Odoo does not show under the Project tag are missed until Finance types
them. For S06637 most of this gap had no Project tag in Odoo. The fix
is tagging those costs in Odoo. Per-item landed costs stay the IPAS's job. Using
the IPAS Landed Cost here would need a rule that drops the matching Odoo expenses.
Revisit this when the OPEX Report is tied to the SOR and the S0 Evaluation.
