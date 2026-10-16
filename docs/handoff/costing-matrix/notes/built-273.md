# Built in #273 (commit 612b7293 on integrate/costing-matrix)

- Migration `20261018150000_costing_purchase_request_items.sql`: purchase_request_items.component_id (FK, ON DELETE SET NULL); source allows 'component'.
- RPCs: purchase_request_add_items_from_components(request, component_ids) — has_purchasing_access() only, all-or-nothing, refuses another SOR's Component, repeat allowed; copies name, qty, unit, odoo product id. costing_component_requests(opp) — id, component, status, request only, gated by costing_can_read (separate from costing_matrix_read). purchase_request_component_labels(request) — "1.2" + name.
- UI: AddFromCostingMatrixDialog.jsx (For Order pre-ticked, all named Components listed); request rows show "1.2 · name"; grid Components show their Requested Items' statuses at all tiers.
- JS: purchaseRequestService.addItemsFromComponents, hasPurchasingAccess; costingMatrixService.componentRequests, requestsByComponent; src/utils/requestedItem.js (componentPickList, componentLabel, ITEM_SOURCE.COMPONENT, ITEM_SOURCE_LABEL); costingKeys.requests.
- No registry rows added; constants unchanged. Changelog v1.9.38.
