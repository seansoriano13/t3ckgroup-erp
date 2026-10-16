# #274 [OPEN] Printed Costing Matrix

## Parent

#266 (Costing Matrix spec)

## What to build

The Costing Matrix prints as a landscape money sheet with four signature blocks, then a specification appendix — showing only what the person printing may see.

- **Sign-offs:** `costing_sign` gains `prepared` (the effective Sales incharge), `costed` (the Purchasing incharge) and `final_approved` (the `final_acquire` list). Triggers clear `prepared` on a Final Offer change, `costed` on Acquire or a markup factor, and `final_approved` on Final Acquire or Final Offer.
- **Form type `costing_matrix`** in the form registry and view model (ADR 0014), landscape A4. Layout reference: branch `prototype/printed-costing-matrix` (#229 — variant C, with variant B's margin strip and variant A's band header).
- **Sheet 1 — money:** one row per Tender Line (ABC, Acquire, Final Acquire, Final Offer, achieved markup), cost-only rows, the summary or "Incomplete — N rows have no cost", the margin strip (final offer, cost, achieved against target, ABC bar), deviations as prose with the alternative's cost where known, a Landed Cost column reading "awaiting purchase", and the four signature blocks ("Signature required" when unsigned; name only with no stored signature or when declined).
- **Sheet 2 — appendix:** each Tender Specification in full against its Components' Offer Specifications, Compliance and notes, then the Inclusions with their covered count, under the owner-band header.
- **Money tier:** a participant's print carries no money keys and no Sheet 1 figures.
- **A Print button** on the PMS tab.
- **Changelog entry.**

## Acceptance criteria

- [ ] **View-model tests:** a money reader gets both sheets; a participant gets no money keys; the incomplete summary text; "Signature required"; the name-only fallback.
- [ ] Signing `prepared` is refused to anyone but the effective Sales incharge, and `final_approved` to anyone off the list.
- [ ] A Final Offer change clears `prepared` and `final_approved`, not `costed`.
- [ ] A 13-line Tender Specification prints in full on Sheet 2.

## Blocked by

- #269 Costing Matrix: markup and achieved markup
- #270 Costing Matrix: the summary, Final Acquire and rates
- #271 Costing Matrix: Evaluation of Specification


## Comments
### seansoriano13 2026-09-17T10:45:13Z
## Amended — #316

**The sheet splits in two,** because under [#225 amended](https://github.com/seansoriano13/t3ckgroup-erp/issues/225#issuecomment-5712996744) almost everything on it is Closed Book.

This ticket already has the natural seam — a money sheet plus a specification appendix:

- **The money sheet** — tender lines, the summary, the ABC gauge, Final Acquire, the Bid Decision and its stamped figures — prints for **Super Admins and the Final Acquire list only**.
- **The specification appendix** — the full ask against each offer, its compliance verdict, the inclusions checklist, deviations in prose — prints for anyone who may see the matrix. No figures on it.

**Add the Bid Decision** (#320) to the money sheet: verdict, reason, decider, date, and the Final Offer and ABC it was taken against. It is what Management is signing.

Sales sees the verdict and reason on screen but never the numbers, and has no path to the money sheet.

What stands: landscape layout, four signature blocks, an incomplete summary still printing, Landed Cost in its own column.

