# #273 [OPEN] Purchase Requests: add Requested Items from the Costing Matrix

## Parent

#266 (Costing Matrix spec)

## What to build

Purchasing adds Requested Items straight from the Costing Matrix, and each Component shows what's being bought for it.

- **Schema:** `purchase_request_items.component_id`, nullable, referencing `costing_components`. One Component may have many Requested Items; each names at most one Component.
- **`purchaseRequestService.addItemsFromComponents(requestId, componentIds)`:** Purchasing access only. Copies name, quantity and unit, keeps its own copy, and sets `component_id`. Refuses a Component on another SOR's matrix.
- **Purchase Request view:** an "Add from the Costing Matrix" picker, defaulting to Components marked For Order; each Requested Item shows its Component ("1.2 · name").
- **Costing Matrix grid:** each Component shows its Requested Items and their statuses, at the non-money tier.
- **Changelog entry.**

## Acceptance criteria

- [ ] **Integration:** the picker defaults to For Order Components; adding links them; a second Requested Item on the same Component is allowed; a Component from another SOR is refused.
- [ ] Editing the Component later doesn't rewrite the Requested Item.
- [ ] **Policy tier:** a sales-side member is refused adding from the matrix.
- [ ] **Page test:** a Component shows its Requested Items' statuses.

## Blocked by

- #268 Costing Matrix: Components, bundles, Inclusions and cost-only rows
- #209 Purchase Requests: Sales and Purchasing coordinate buying per SOR


## Comments

