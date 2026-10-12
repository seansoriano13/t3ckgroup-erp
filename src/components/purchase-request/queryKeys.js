/** React Query keys for a Purchase Request's parts (#209). */
export const purchaseRequestKeys = {
  all: (requestId) => ["purchase-request", requestId],
  header: (requestId) => ["purchase-request", requestId, "header"],
  canManage: (requestId) => ["purchase-request", requestId, "can-manage"],
  items: (requestId) => ["purchase-request", requestId, "items"],
  canAddItems: (requestId) => ["purchase-request", requestId, "can-add-items"],
  pickableLines: (requestId) => ["purchase-request", requestId, "pickable-lines"],
  /** The SOR's stock snapshot (#202), as the picker and the saved items read it (#501). */
  stock: (requestId) => ["purchase-request", requestId, "stock"],
  itemActor: (requestId) => ["purchase-request", requestId, "item-actor"],
  poLines: (requestId, itemId) => ["purchase-request", requestId, "po-lines", itemId],
  messages: (requestId) => ["purchase-request", requestId, "messages"],
  members: (requestId) => ["purchase-request", requestId, "members"],
};

/** The Purchase Requests list (#308, #179): every request the signed-in employee may read. */
export const procurementQueueKey = ["procurement-queue"];
