# Built in #268 (commit 753d36d4 on integrate/costing-matrix)

- Migration `supabase/migrations/20261018110000_costing_matrix_components.sql` (+ staging.sql mirror).
- Tables: costing_components (incl. odoo_product_id, is_bundle, status/availability/source, po_rfq_no, offer_specification, sales_incharge_id/purchasing_incharge_id overrides, quantity, unit), costing_component_costs (acquire_unit, odoo_unit, final_acquire_unit, markup_factor — money table), costing_inclusions (bundle-only, heading, completeness), costing_cost_rows (money table).
- NOT yet added: compliance, compliance_note, recommended_alternative (#271). Inclusion Completeness is technical band (= Purchasing access until #271 widens costing_is_technical).
- Registry: final_acquire_unit and markup_factor already registered — band management, tier closed_book only. Acquire → cost+closed_book. Odoo unit → price, cost, closed_book. `costing_component_costs.*` band = sales, purchasing, management (row created on first typed column).
- RPCs: costing_move_inclusion, costing_add_cost_row, costing_remove_cost_row, costing_move_legacy_inclusions(opp) (service role). costing_set_money handles cost-only rows (they carry matrix_id).
- costing_enforce_bands(): an INSERT column left at its default is not judged.
- Removing a Tender Line removes its Components/costs/Inclusions explicitly (history keeps them).
- Service adds: addComponent, updateComponent, removeComponent, addInclusion, updateInclusion, removeInclusion, moveInclusion, addCostRow, updateCostRow, removeCostRow, setIncharge; exports CostingRuleError, toRuleError. shapeMatrix returns each line's `components` (numbered 1.1…) with inclusions, plus costRows and costRowsTotals.
- costingMath adds: lineTotals → acquireTotal, odooTotal; componentTotals, costRowTotals, costRowsTotals.
- Constants (src/constants/costing.js): COMPONENT_COST_TIERS, COMPONENT_BANDS, COMPONENT_COST_BANDS, INCLUSION_BANDS, COST_ROW_BANDS, ROW_EDIT_BANDS, inAnyBand, tierReadsCost. Policy 79 asserts these equal the DB registries — when you add registry rows, update the constants and that assertion keeps passing.
- UI (src/components/costing/): ComponentBlock, InclusionList, CostRowGrid, InchargeSelects, BandHeader, GridCell, gridFormat.js, useCostingWrites.js.
- The Purchase Request card now lives only on the PMS tab. No-matrix state shows a plain line.
- Policy cleanup helper deletes deepest tables first. Fake DB has a mirror of the bundle-only trigger.
- InclusionsPanel.jsx deleted.
