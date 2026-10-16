# #270 [OPEN] Costing Matrix: the summary, Final Acquire and rates

## Parent

#266 (Costing Matrix spec)

## What to build

The matrix computes the sheet's summary exactly, Management sets Final Acquire from a named list, and Finance edits the rates.

- **Schema:** `costing_settings`, a single row (vat_divisor 1.12, tax_rate 0.06, retention_rate 0.01, itr_rate 0.08, itr_allowance 250000); `costing_signer_lists` seeded with 101 on `final_acquire` by employee code.
- **Bands:** Final Acquire on Components and cost-only rows → the `final_acquire` list only, and Super Admins don't pass; Marketing and OPEX → Finance access or the list; rates → Finance access or Super Admin; signer lists → Super Admin.
- **`costingMath.summary(matrix, settings)`:** VAT-exclusive, Tax on the gross offer, Retention, Collected, Operational Expenses (the Final Acquire total), Marketing, OPEX, ITR and Revenue. Exact decimals, rounded half-up to the centavo on return. `incomplete.missingCost` and `incomplete.missingOffer` counts replace what can't be computed. ITR follows the sheet literally, so it is negative below the allowance. The ABC total check applies only when every Tender Line has an ABC.
- **Service:** `getSettings`, `setSettings`, `getSignerLists`, `setSignerList`; Final Acquire through `updateComponent` and `updateCostRow`.
- **Grid foot:** the summary, "Incomplete — N rows have no cost" where Revenue would be, and the ABC gauge. The settings page gains Rates and Signer lists sections.
- **Changelog entry.**

## Acceptance criteria

- [ ] **Unit, to the centavo (#213):** Final Offer ₱2,980,000 with Final Acquire blank → VAT-exclusive ₱2,660,714.29, Tax ₱178,800.00, Retention ₱29,800.00, Collected ₱2,771,400.00, ITR ₱218,400.00, Revenue incomplete.
- [ ] **Unit (#213):** Final Offer ₱3,930,715 and Final Acquire ₱1,156,780 → Tax ₱235,842.90, Retention ₱39,307.15, Collected ₱3,655,564.95, ITR ₱294,457.20, Revenue ₱2,479,477.80.
- [ ] **Unit (#229 sample):** Final Offer ₱2,980,000 and Final Acquire ₱2,338,500 → Revenue ₱423,100.00, at 93.1% of an ABC of ₱3,200,000.
- [ ] **Unit:** a changed rate changes the figures; a Tender Line without a Final Offer marks the offer figures incomplete.
- [ ] **Policy tier:** a Super Admin off the list refused Final Acquire; a list member allowed; Purchasing refused Marketing; Finance allowed Marketing and rates; a plain employee refused signer lists.
- [ ] **Page test:** the incomplete summary renders its text.

## Blocked by

- #268 Costing Matrix: Components, bundles, Inclusions and cost-only rows


## Comments
### seansoriano13 2026-09-17T10:45:09Z
## Amended — #316

**The summary and Final Acquire become Closed Book** ([#225 amended](https://github.com/seansoriano13/t3ckgroup-erp/issues/225#issuecomment-5712996744), spec in #319) — read only by Super Admins and the Final Acquire list. Neither Sales nor Purchasing sees the summary; Finance drops out of it and keeps Landed Cost.

**The markup factor joins them** ([#224 amended](https://github.com/seansoriano13/t3ckgroup-erp/issues/224#issuecomment-5712999138)) and is set by this ticket's Final Acquire list.

**This ticket carries the Bid Decision** (#320) — Go / No-go / Revise against the Final Offer total and ABC it was taken at. Its decider is **this ticket's existing Final Acquire list**; deliberately not a second list, which would hold the same names and drift. Changing any Final Offer or Final Acquire clears it.

The summary arithmetic itself is unchanged (#213), and it is the same arithmetic #321's Offer Projection must reuse — one implementation, not two.

