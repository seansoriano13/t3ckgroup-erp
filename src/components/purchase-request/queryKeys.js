/** React Query keys for a Purchase Request's parts (#209). */
export const purchaseRequestKeys = {
  all: (requestId) => ["purchase-request", requestId],
  header: (requestId) => ["purchase-request", requestId, "header"],
  canManage: (requestId) => ["purchase-request", requestId, "can-manage"],
  items: (requestId) => ["purchase-request", requestId, "items"],
  canAddItems: (requestId) => ["purchase-request", requestId, "can-add-items"],
  /** The SOR's stock snapshot (#202), as the picker and the saved items read it (#501). */
  stock: (requestId) => ["purchase-request", requestId, "stock"],
  itemActor: (requestId) => ["purchase-request", requestId, "item-actor"],
  poLines: (requestId, itemId) => ["purchase-request", requestId, "po-lines", itemId],
  p0Suggestions: (requestId, itemId) => ["purchase-request", requestId, "p0-suggestions", itemId],
  /** The once-per-open read of the request's P0s from Odoo (#685). */
  p0Sync: (requestId) => ["purchase-request", requestId, "p0-sync"],
  messages: (requestId) => ["purchase-request", requestId, "messages"],
  members: (requestId) => ["purchase-request", requestId, "members"],
};

/** The request's Canvass grid (#970). Under ["canvass"], so `useRefreshRequest` refreshes it after any change. */
export const canvassKeys = {
  request: (requestId) => ["canvass", "request", requestId],
  unlocks: (requestId) => ["canvass", "request", requestId, "unlocks"],
  projection: (requestId) => ["canvass", "request", requestId, "projection"],
};

/** The Purchase Requests list (#308, #179): every request the signed-in employee may read. */
export const procurementQueueKey = ["procurement-queue"];
