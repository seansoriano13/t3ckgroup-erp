# Built in #269 (commits 6a7ddb73, 2e8df12a)

- Migration `20261018120000_costing_matrix_markup.sql`: costing_markup_presets (label, factor, sort, active; Super Admin or final_acquire list edit/read); costing_matrix_money.default_factor, default_preset_id (management band, closed_book read); Markup Price virtual column `markup_price_unit` on components and cost-only rows (tiers price + closed_book), rounded per unit then × quantity.
- costingMath: markupPriceUnit, markupPrice, effectiveFactor, componentMarkup, lineMarkup, matrixMarkup, markupPriceSum, percentOver. Overall achieved markup is blank if any line has no Components or any cost is blank.
- Service: setDefaultMarkup(matrixId, { factor | presetId }), listPresets, savePreset, canManageMarkup.
- UI: factor ×1.35 · +35% for Closed Book; Markup Price per row + line sum beside Final Offer for price + closed_book. Settings: src/components/costing/settings/CostingMatrixSettings.jsx (section list) + MarkupPresetsSection.jsx; Final Acquire list members open Settings with only the Costing Matrix section (`costingOnly`).
- Constants: MATRIX_MONEY_TIERS, MATRIX_MONEY_BANDS; markup_price_unit in COMPONENT_COST_TIERS. Stub option `manageMarkup`. Query keys costingKeys.presets(), canManageMarkup().
- No preset seed rows.
