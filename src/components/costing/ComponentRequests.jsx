import { ShoppingCart } from "lucide-react";

import StatusBadge from "../StatusBadge";
import { ITEM_STATUS_LABELS, ITEM_STATUS_THEME } from "../../constants/purchaseRequest";

/**
 * What is being bought for a Component (#273): its Requested Items and their statuses. Every tier
 * that reads the matrix sees this; it carries no name, quantity, price or requester. Draws nothing
 * when nothing has been requested.
 */
export default function ComponentRequests({ items }) {
  if (!items?.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="component-requests">
      <ShoppingCart size={12} className="shrink-0" aria-hidden="true" />
      <span>Requested Items</span>
      {items.map((item) => (
        <StatusBadge key={item.id} label={ITEM_STATUS_LABELS[item.status] || item.status} theme={ITEM_STATUS_THEME[item.status]} />
      ))}
    </div>
  );
}
