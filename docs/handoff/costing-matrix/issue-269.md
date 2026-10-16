# #269 [OPEN] Costing Matrix: markup and achieved markup

## Parent

#266 (Costing Matrix spec)

## What to build

Purchasing sets a markup, and Sales sees the suggested price and the achieved markup beside each Final Offer.

- **Schema:** `costing_markup_presets` (label, factor, sort, active; deactivated, never deleted); `costing_matrix_money.default_factor` and `default_preset_id`, Purchasing band; row `markup_factor` overrides on Components and cost-only rows (cost-only rows default to 1.00). Presets: Purchasing access or Super Admin.
- **`costingMath`:** `markupPrice` (null on a blank Acquire); each line's Markup Price sum and achieved markup (Final Offer total ÷ its Components' Acquire total); the overall achieved markup, counting cost-only rows.
- **Service:** `setDefaultMarkup({ factor | presetId })`, `listPresets`, `savePreset`; overrides through `updateComponent` and `updateCostRow`.
- **Grid:** the factor shown as ×1.35 and +35%; Markup Price per row; each Tender Line shows its Markup Price sum and achieved-against-target beside Final Offer; the header shows the overall figure. Nothing fills Final Offer.
- **Costing Matrix settings** page in the Purchasing Module, starting with a Markup presets section.
- **Changelog entry.**

## Acceptance criteria

- [ ] **Unit:** ×1.47 on the vehicle and ×1.00 on the ₱100,000 Delivery Charge give the expected Markup Prices; a blank Acquire gives null Markup Price and null achieved markup; cost-only rows change the overall figure but not a line's.
- [ ] Changing the factor leaves Final Offer unchanged.
- [ ] **Policy tier:** Sales refused the default factor and overrides; a plain employee refused writing presets.
- [ ] **Service test:** picking a preset sets the default factor; a row override survives a default change.

## Blocked by

- #268 Costing Matrix: Components, bundles, Inclusions and cost-only rows


## Comments
### seansoriano13 2026-09-17T10:44:52Z
## Amended — #316

Two changes, both from [#224 amended](https://github.com/seansoriano13/t3ckgroup-erp/issues/224#issuecomment-5712999138) and [#225 amended](https://github.com/seansoriano13/t3ckgroup-erp/issues/225#issuecomment-5712996744).

**The markup factor is set by the Final Acquire list and belongs to the Closed Book.** Sales reads the peso Markup Price and never the factor behind it — otherwise `Markup Price ÷ factor` gives them the Acquire and the whole split collapses.

**Achieved markup becomes Closed Book only.** This ticket currently shows each tender line "the markup it actually achieves beside the target" to Sales. That figure is the margin stated directly, so it moves behind #319's tier.

What stands: the factor itself, presets the business edits, per-row override, cost-only rows at ×1.00, Markup Price as a suggestion, Sales typing the Final Offer.

