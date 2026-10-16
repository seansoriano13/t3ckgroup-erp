# SOR modal, PMS sections, line items, Purchase Requests, settings, Approval Center

## SOR modal structure (#207/#298)

- Entry: `src/components/sor/OpportunityDetailsModal.jsx` (thin wrapper) → `src/components/sor/modal/SorModal.jsx`.
- SorModal resolves `accessLevel` (`opportunityService.getAccessLevel`) and returns early:
  `"none"` → `NoAccessSorSlideOver`; `"locked"` → `src/components/sor/LockedSorSlideOver.jsx`
  (summary + own past visits; "No tabs, no chat, no edit") — the **locked view**, so nothing new
  appears there unless added to that file.
- Otherwise renders `<SummaryLayout p={layoutProps} />` (`summary/SummaryLayout.jsx`), or a
  staging-only `PrototypeShell` (`modal/prototype/`, build-gated layout previews; ADR 0028).
- `layoutProps.ctx` = `tabCtx` (SorModal l.~816): opportunity, id, accessLevel, isRestricted,
  user, isEditing, employees, checklist, items, itemsLoading, handleRefreshStock, refreshingStock,
  invalidate, onClose, …. `p.canViewJourney`, `p.hasOpened`, `p.markOpened`, `p.canEdit`.
- "Tabs" are **nested views** in `src/components/sor/modal/summary/NestedShell.jsx`:
  ```js
  export function nestedViews(p) {
    const blocked = blockedLabels(p.checklist).length;
    return [
      { key: "now", label: "This stage", badge: blocked || null, badgeTone: "amber" },
      { key: "items", label: "Products", badge: p.ctx.items.length || null },
      p.canViewJourney && { key: "journey", label: "History" },
      showMoney(p) && { key: "commission", label: "Commission" },
    ].filter(Boolean);
  }
  ```
  Bodies render in the same file: `{view === "journey" && (<div className="h-full overflow-y-auto"><JourneyTab .../></div>)}`;
  "now" and "items" stay mounted once opened (`opened.includes(...)`). Default view `"summary"`
  (rendered by SummaryLayout's `Summary`), crumb nav `nav="pills"`.
  Prior art for adding/removing a view: commit `96173eea` (#314) removed
  `{ key: "buying", label: "Inclusions & purchasing" }` and its body
  (`<InclusionsPanel opportunity={opportunity} isRequired={ctx.requiresInclusions} />` +
  `PurchasingPanel`) from exactly these two places.
- `showMoney(p)` in `summary/shared.jsx` l.300: `p.ctx.accessLevel !== "participant"`.
- Other files: `NowTab.jsx`, `ItemsTab.jsx`, `JourneyTab.jsx`, `DetailsTab.jsx`, `SorModalHeader.jsx`,
  `useSorModalData.js` (`useSorModalData({ queryKey, queryFn, ... })` lazy per-tab queries under
  the `["sorModalTab", ...]` prefix; `useWarmTabs`).

## Where the PMS sections render today (they render in TWO places)

Both `summary/SummaryLayout.jsx` (left column of the Summary, l.38-43) and `modal/NowTab.jsx`
(l.232-239) render, in this order:
```jsx
{/* #310: renders nothing for an SOR with no Purchase Request. */}
<PurchaseRequestCard opportunityId={id} />          // src/components/sor/modal/PurchaseRequestCard.jsx
{/* #249 */}<IpasSorSection opportunityId={id} />   // src/components/ipas/IpasSorSection.jsx (also shows #265 order standing via useIpasSorSummaries → ipasSorStandingService)
{/* #257 */}<HandoffsSorSection opportunityId={id} /> // src/components/sor/HandoffsSorSection.jsx (sorHandoffsService)
```
Each renders nothing when empty. Data: `useSorPurchaseRequest.js` (RPC `sor_purchase_request_overview`),
`components/ipas/useIpasSorSummaries.js` → `ipasSorStandingService.summariesForSor` (RPCs `ipas_summaries_for_sor`, `ipas_standing_for_sor`),
`sorHandoffsService` (RPC `handoffs_for_sor`).
Tests: `components/ipas/IpasSorSection.test.jsx` (stubRpc + `vi.mock` AuthContext),
`components/sor/modal/PurchaseRequestSor.test.jsx` (opens `OpportunityDetailsModal`, clicks
`/^This stage/`), `components/sor/modal/SorModal.test.jsx`, `SorModalAccessLevel.test.jsx`.

## Hidden Inclusions / Canvass panels and `sor_inclusions`

- `src/components/sor/InclusionsPanel.jsx` and `src/components/CanvassPanel.jsx` still exist but
  are **mounted nowhere** (unmounted by #314). Their tests still run (`InclusionsPanel.test.jsx`,
  `CanvassPanel.test.jsx`).
- Service: `src/services/projectEvaluationService.js` — `listInclusions`, `addInclusion(s)`,
  `updateInclusion`, `setSourcing`, `removeInclusion`, `reorderInclusions`, canvass functions
  (`getCanvass`, `addOffer`, `markWinner`, …), `stampInclusionCost`, `refreshInclusionCost`,
  `getCostSummary`. Gate evidence: `opportunityService` `hasInclusionsFor` (l.~437, for the
  hidden `inclusions` condition kind).
- `sor_inclusions` columns: id, opportunity_id, description (not null), quantity numeric(12,2)
  default 1, unit, note, completeness text default 'MISSING' CHECK
  (`COVERED`,`MISSING`,`SUBSTITUTED`,`NOT_REQUIRED`), sourcing CHECK
  (`STOCKABLE_AVAILABLE`,`STOCKABLE_NEEDS_ORDERING`,`SOURCE_OUT`), sort_order, created_by
  (FK `sor_inclusions_created_by_fkey`), created_at, updated_at, cost_amount numeric(14,2),
  cost_source CHECK (`CANVASS_OFFER`,`ODOO_CATALOG`,`MANUAL`), cost_established_at.
  Trigger `trg_sor_inclusions_touch`. Policies: read `sor_can_edit_opportunity(opportunity_id) OR is_hr()`;
  insert/delete `sor_can_edit_opportunity`; update also lets a purchasing employee.
  Old canvass tables: `sor_canvasses`, `sor_canvass_offers` (untouched by #314).

## SOR line items (Product List)

- Table `sales_opportunity_items`: id, opportunity_id, **product_name** (not null), **unit**,
  **quantity** numeric(12,2) default 1, **unit_price** numeric(18,2) default 0, sort_order,
  created_at, updated_at, **odoo_product_id** integer (the Odoo product id, #202).
- `opportunityService.updateOpportunity(id, payload, actorId)` (l.1827) → `replaceItems`
  (l.2603) → RPC `sor_replace_items(p_opportunity_id, p_items jsonb)`: locks the SOR, requires
  `sor_can_edit_opportunity`, returns the old rows, **deletes every line and inserts new rows**.
  ⇒ line ids change on every save. A `sor_item_id` FK pointing here must be `on delete set null`
  (or carry no FK), and "SOR line now says" must re-match lines, not trust the id.
- Matching prior art (Requested Items): SQL `purchase_request_item_lines(p_request_id)` matches
  by `odoo_product_id` when set, else `lower(btrim(product_name)) = lower(btrim(snapshot->>'name'))`,
  preferring the line whose quantity equals the snapshot's. Snapshot shape stored by
  `purchase_request_add_item_from_line`: `jsonb_build_object('name', v_name, 'quantity', qty, 'unit', v_unit)`.
  Pure comparer `sorLineChange(item)` in `src/utils/requestedItem.js` → `null` |
  `{kind:"removed", label:"SOR line removed"}` | `{kind:"changed", quantity, unit, label:"SOR line now says 10 pc"}`
  (`formatAmount(quantity, unit)`).
- Participant read without prices: RPC `sor_participant_items` (`opportunityService.getParticipantItems`).
- Fake for replace: `src/test/stubs/replaceItemsRpc.js`; tests `opportunityReplaceItems.test.js`.

## Stock Availability (#202)

- Table `sor_stock_snapshots` (opportunity_id, fetched_at, fetched_by, data jsonb
  `{ products: { [odoo_product_id]: { type, free, onHand, forecast, byWarehouse } } }`).
- `opportunityService.getStockSnapshot(id)` (l.2640) / upsert at l.2631; SorModal `handleRefreshStock`.
- Pure rule `stockBadge({ quantity, product, odooProductId })` and `isStockStale(fetchedAt, now)`
  in `src/constants/stock.js` (`STOCK_BADGE`, `STOCK_BADGE_THEME`). Row UI:
  `ItemStockRow({ item, snapshotData })` exported from `src/components/sor/modal/ItemsTab.jsx` l.40.
- For a Buyer without SOR read: `purchaseRequestService.stockSnapshot(requestId)` → RPC
  `purchase_request_stock_snapshot`. `requestedItemStock(item, snapshot, now)` in utils/requestedItem.js.

## Purchase Requests

- `purchase_requests`: id, opportunity_id (unique index `purchase_requests_opportunity_id_key`, FK
  cascade), opened_by_action_id, opened_visit_id, buyer_id, created_by, created_at, updated_at,
  access_until, access_until_stage_id, title, requesters jsonb.
- `purchase_request_items`: id, request_id (FK cascade), **source** CHECK (`sor_line`,`new`) — a
  third source needs this CHECK widened, odoo_product_id, name (CHECK non-blank), unit, quantity
  numeric(12,2) CHECK > 0, description, images jsonb, sor_line_snapshot jsonb, status CHECK
  (`requested`,`from_stock`,`to_order`,`canvassing`,`ordered`,`received`,`substituted`,`cannot_source`,`cancelled`),
  po_number, po_verification, substitute_for_item_id, odoo_po_line_ids int4[], requested_by,
  status_changed_by/at, created_at, legacy_procurement_request_id. No `component_id` yet.
  FK names: `purchase_request_items_requested_by_fkey`, `..._request_id_fkey`, ….
  RLS read: `can_read_purchase_request(request_id)`; all writes via RPCs.
- Add-item RPC shape: `purchase_request_add_item_from_line(p_request_id, p_line_id) returns uuid`:
  `v_req := _purchase_request_for_adding(p_request_id, 'fn')` (signed in, request exists, and
  `purchase_request_can_add_items` = sales side or Buyer — NOT "Purchasing access only"), validates
  line belongs to the request's SOR (P0002), inserts, then `perform _purchase_request_item_added(v_item)`
  (posts an `item_added` message, bumps `updated_at`).
- `src/services/purchaseRequestService.js` (`purchaseRequestService`): `listQueue`, `getSorOverview`,
  `openDirect`, `get`, `canManageMembers`, `addMember`, `removeMember`, `canAddItems`,
  `pickableLines`, `stockSnapshot`, `addItemFromLine`, `addNewItem`, `listItems` (attaches `sorLine`
  from `purchase_request_item_lines`), `itemActor`, `setItemStatus`, `verifyPo`, `orderItem`,
  `poLines`, `pickPoLines`, `cancelItem`, `addSubstitute`, `listMessages(Page)`, `listMembers`,
  `postMessage`, `take`, `setBuyer`. Every write `supabase.rpc(...)`; `if (error) throw error`.
- UI: `src/components/purchase-request/` — `PurchaseRequestView.jsx`, `PurchaseRequestModal.jsx`
  (opened through `GlobalDetailManager` event `{ id, type: "PURCHASE_REQUEST" }`),
  `AddRequestedItems.jsx` (line picker dialog; `refusal(error)` strips the `fn_name: ` prefix),
  `RequestedItems.jsx` → `RequestedItemRow.jsx({ item, stockSnapshot, actions, replaces, replacedBy })`,
  `RequestedItemActions.jsx`, `queryKeys.js` (`purchaseRequestKeys`), `requestHooks.js`.
  Tests: `RequestedItems.test.jsx`, service tests `src/services/purchaseRequestItems.test.js`
  with `stubPurchaseRequestItemRpcs({ actorId })` (`src/test/stubs/purchaseRequestItemRpc.js`).
  Policy: `39-purchase-request-items.test.js`, `55-purchase-request-stock-snapshot.test.js`.

## Purchasing Module settings

- Rendered as the "Purchasing" tab of Settings: `src/pages/settings/index.jsx` l.364
  `{ value: "purchasing", label: "Purchasing", isPermitted: (c) => c.isSuperAdmin || c.hasPurchasingFlow, Panel: PurchasingPanel }`
  → `<PurchasingSettings isSuperAdmin={isSuperAdmin} />`. **Finance-only or Final-Acquire-list-only
  people cannot open this tab** (relevant for Rates / Bid Decision settings).
  `/purchasing/ipas/settings` redirects to `/settings?tab=purchasing`.
- `src/components/settings/PurchasingSettings.jsx` (65 lines): one `TabGroup variant="pill"`
  over the IPAS option lists, Transmittal lists, `{ value: "ageing", label: "Ageing rules" }` →
  `<OrderAgeingRules />` (`src/components/settings/OrderAgeingRules.jsx`), and Super-Admin-only
  `{ value: "signers", label: "Sign-off lists" }` → `<TransmittalFirstNumber/>` + `<IpasSignerListEditor/>`
  (`src/components/ipas/IpasSignerListEditor.jsx`). Header text "IPAS lists". New sections =
  new tab values + branches in the same ternary.
- Settings service prior art: `src/services/orderAgeingRulesService.js` (`getRules`, `setRule`
  via `.upsert(..., { onConflict: "step" })`, validation throws `IpasError(IPAS_ERROR.INVALID, msg)`).
  Tests: `src/test/pages/orderAgeingRulesPages.test.jsx`, `src/test/pages/settingsPage.test.jsx`,
  policy `75-order-ageing-rules.test.js`.

## Approval Center — adding a queue

- Registry `APPROVAL_QUEUES` in `src/pages/approvals/_components/useApprovalQueues.js`:
  `{ key: "ipas", path: "/approvals/ipas", label: "IPAS Sign-offs", icon: ReceiptText, can: (r) => r.isIpasApprover }`.
  `useApprovalRoles()` returns the role flags (`isIpasApprover` from the user record; Transmittal
  Check-by from a query `transmittalService.myStaffLists(user.id)`).
- Flag source: `src/services/employeeService.js` l.~53-126 computes `isIpasApprover` from the
  employee's `ipas_signer_lists` keys when loading the signed-in user.
- Page: `src/pages/approvals/ipas/index.jsx` (wrapped in `<ProtectedRoute requireIpasApprover>`;
  `ApprovalCenterLayout`, `ApprovalToolbar`, `ApprovalTable`, `ApprovalSheet`, a review
  component `_components/IpasSignoffReview.jsx`; items mapped by `ipasToItem` in
  `src/utils/approvalItems.js`; data `ipasService.pendingSignoffsFor(user.id)`).
  Second example: `src/pages/approvals/transmittals/index.jsx`.
- Also touch: `src/pages/approvals/index.jsx` (redirect order), `src/components/ProtectedRoute.jsx`
  (`requireIpasApprover`), nav entry in `src/constants/navigation.js` (~l.255-262
  `isPermitted: (ctx) => ctx.isIpasApprover`), badge counts in `src/hooks/useNavBadges.js` (l.73-80).
- Tests: `src/test/pages/ipasSignoffsPages.test.jsx`, `approvalsRedirect.test.jsx`, `approvalReview.test.jsx`.
