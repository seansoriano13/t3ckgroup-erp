import { AlertTriangle, Replace } from "lucide-react";

import StatusBadge from "../StatusBadge";
import { AttachmentEvidence } from "../ui/AttachmentEvidence";
import { ITEM_STATUS, ITEM_STATUS_LABELS } from "../../constants/purchaseRequest";
import { STOCK_BADGE_THEME } from "../../constants/stock";
import { STATUS_THEME } from "../../constants/statusTheme";
import { formatDate } from "../../utils/formatDate";
import { ITEM_SOURCE, formatAmount, requestedItemStock, sorLineChange } from "../../utils/requestedItem";

const ITEM_STATUS_THEME = {
  [ITEM_STATUS.REQUESTED]: STATUS_THEME.BLUE,
  [ITEM_STATUS.FROM_STOCK]: STATUS_THEME.GREEN,
  [ITEM_STATUS.TO_ORDER]: STATUS_THEME.AMBER,
  [ITEM_STATUS.CANVASSING]: STATUS_THEME.VIOLET,
  [ITEM_STATUS.ORDERED]: STATUS_THEME.BLUE,
  [ITEM_STATUS.RECEIVED]: STATUS_THEME.GREEN,
  [ITEM_STATUS.SUBSTITUTED]: STATUS_THEME.ORANGE,
  [ITEM_STATUS.CANNOT_SOURCE]: STATUS_THEME.RED,
  [ITEM_STATUS.CANCELLED]: STATUS_THEME.MAUVE,
};

/**
 * One Requested Item (#305) as it was picked or described: its amount and
 * status; for an item from an SOR line, its product's stock with the time it
 * was read and, when the line has since changed, what it says now; for a new
 * product, its description and images.
 *
 * `stockSnapshot` is the SOR's `sor_stock_snapshots` row. `actions` is a slot
 * for the status controls (#306). `replaces` / `replacedBy` are the items on
 * either end of a Buyer's substitute, when the request has them.
 */
export default function RequestedItemRow({ item, stockSnapshot, actions = null, replaces = null, replacedBy = null }) {
  const stock = requestedItemStock(item, stockSnapshot);
  const change = sorLineChange(item);
  const isNew = item.source === ITEM_SOURCE.NEW;

  return (
    <li className="flex flex-col gap-1.5 py-3" data-testid="requested-item">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground break-words">{item.name}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{formatAmount(item.quantity, item.unit)}</span>
            {" · "}
            {isNew ? "New product" : "From the SOR"}
            {item.requester?.name && ` · ${item.requester.name}`}
          </p>
        </div>
        <StatusBadge label={ITEM_STATUS_LABELS[item.status] || item.status} theme={ITEM_STATUS_THEME[item.status]} />
        {actions}
      </div>

      {(replaces || replacedBy) && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Replace size={12} className="shrink-0" />
          {replaces ? `Substitute for ${replaces.name}` : `Replaced by ${replacedBy.name}`}
        </p>
      )}

      {stock && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <StatusBadge label={stock.badge.label} theme={STOCK_BADGE_THEME[stock.badge.kind]} />
          {stock.fetchedAt && <span>Stock as of {formatDate(stock.fetchedAt)}</span>}
        </div>
      )}

      {change && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle size={12} className="shrink-0" />
          {change.label}
        </p>
      )}

      {item.description && (
        <p className="text-xs leading-relaxed whitespace-pre-line text-muted-foreground">{item.description}</p>
      )}
      {item.images?.length > 0 && <AttachmentEvidence attachments={item.images} />}
    </li>
  );
}
