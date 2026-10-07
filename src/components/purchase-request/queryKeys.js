/** React Query keys for a Purchase Request's parts (#209). */
export const purchaseRequestKeys = {
  all: (requestId) => ["purchase-request", requestId],
  items: (requestId) => ["purchase-request", requestId, "items"],
  canAddItems: (requestId) => ["purchase-request", requestId, "can-add-items"],
  pickableLines: (requestId) => ["purchase-request", requestId, "pickable-lines"],
  itemActor: (requestId) => ["purchase-request", requestId, "item-actor"],
};

/** The SOR's stock snapshot (#202), as the request's items read it. */
export const sorStockKey = (opportunityId) => ["purchase-request-sor-stock", opportunityId];
