# ADR 0053 — One Canvass per Purchase Request, suppliers added once, winner per line

## Status
Accepted (2026-11-12), spec #956, ticket #968. Replaces the "one Canvass per line" part of ADR 0034, ADR 0042 and ADR 0047. The rest of ADR 0047 still holds.

## Context

ADR 0034, 0042 and 0047 made a Canvass one comparison on one product line. A request with ten lines meant ten Canvasses, ten numbers and ten windows, and nobody could see the whole comparison at once. The team's own sheet (PMS 3 CANVASS MATRIX) is one grid: every line down the page, Offer 1, 2 and 3 across. The per-line Canvass is on prod but has not been used for real work yet, so this is the moment to change its shape.

## Decision

1. **One Canvass per Purchase Request** (a project's request or a Direct request). It holds every line of the request and gets one number (CNV_0001 and up), when its first supplier is saved.
2. **Suppliers are added once.** A supplier carries the currency, the comparison rate, how long the quote holds, the lead time and the quality note. Its brand, description, price, source link, brochure and remarks are typed per line it quotes. A supplier may skip lines. An **Offer** keeps its name and now means one supplier's answer on one line.
3. **Winner and reason per line.** Each line has its own winner and its own written reason. "This supplier wins every line" and "use the same reason for all" are shortcuts, not a different model.
4. **Three suppliers, counted per Canvass.** A winner can be picked on any line only once the Canvass has three suppliers, or "No other supplier" notes cover the missing ones. A line that fewer suppliers quoted just shows it; it is not blocked.
5. **Still canvassing** starts on a line when the first supplier price is typed on it (it used to start when the Canvass was opened).
6. **A line locks when it is marked Purchased.** Its prices, winner and reason stop changing. A Super Admin can unlock it, always with a reason kept in the history. This replaces the lock that came from making a Purchase Request out of a Canvass.
7. **Old per-line Canvasses are deleted**, on staging and prod, not converted. Before the prod run the rows are counted and the run stops if any has a winner picked.
8. **S0 Evaluation** opens the request's Canvass at that line. With no request yet, it says to raise the request first. A winner still fills the line's Acquire, Offer Specification and documents, and proposes its Brand.

## What this replaces, and what still holds

Replaced:
- ADR 0034: a Canvass is no longer one per Requested Item or Component, and is no longer numbered per line. (Its idea that buying outside a project starts from a Direct request already ended in ADR 0047.)
- ADR 0042: the Canvass subject is no longer the product line. The subject is the Purchase Request; the line is a row inside it. A winner on a project line still fills the Acquire of the Component linked to that line's SOR line.
- ADR 0047: "three slots" is no longer three slots on one line's Canvass, it is three suppliers on the whole Canvass. The Canvass lock (a Purchase Request made from it) is replaced by the per-line lock above.

Still holds from ADR 0047:
- No sign-off. Only "Canvassed by" signs. The Approval Center queue and the Check-by part of the print stay gone.
- One starting point: a Canvass is never started with no Purchase Request, and a Purchase Request is never made from Canvasses.
- "No other supplier": a written reason, who wrote it and when, counts toward the three. It now covers the missing suppliers of the whole Canvass, and stops counting once a supplier fills that place.

## Consequences

- One print per request in the PMS 3 CANVASS MATRIX layout: lines down, suppliers across, three per page (#971).
- The Canvasses page lists one row per request (#973).
- Tables and rules change in #967 and #969; the grid is #970. The Release Notes samples that show a Canvass (`src/components/release-notes/purchasingSamples.jsx`) are updated in the grid ticket (#970).
