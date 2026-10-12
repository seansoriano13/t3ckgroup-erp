import { AlertTriangle, FileText, Replace } from "lucide-react";

import StatusBadge from "../StatusBadge";
import { AttachmentEvidence } from "../ui/AttachmentEvidence";
import { ITEM_STATUS_LABELS, ITEM_STATUS_THEME } from "../../constants/purchaseRequest";
import { PO_VERIFICATION_LABELS } from "../../constants/procurement";
import { STOCK_BADGE_THEME } from "../../constants/stock";
import { formatDate } from "../../utils/formatDate";
import { ITEM_SOURCE, formatAmount, poLineNotPicked, requestedItemStock, sorLineChange } from "../../utils/requestedItem";

/**
 * One Requested Item (#305) as it was picked or described: its amount and
 * status; for an item from an SOR line, its product's stock with the time it
 * was read and, when the line has since changed, what it says now; for a new
 * product, its description and images.
 *
 * `stockSnapshot` is the SOR's `sor_stock_snapshots` row. `actions` is a slot
 * for the status controls (#306). `replaces` / `replacedBy` are the items on
 * either end of a Buyer's substitute, when the request has them.
 *
 * Once Ordered on a PO (#312): the PO number, what Odoo said about it, and the
 * PO line(s) picked — or "PO line not picked" until Purchasing picks them.
 */
export default function RequestedItemRow({ item, stockSnapshot, actions = null, replaces = null, replacedBy = null }) {
  const stock = requestedItemStock(item, stockSnapshot);
  const change = sorLineChange(item);
  const isNew = item.source === ITEM_SOURCE.NEW;
  const lines = item.odoo_po_line_ids || [];

  return (
    <li className="flex flex-col gap-2 py-3" data-testid="requested-item">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground break-words leading-snug">{item.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{formatAmount(item.quantity, item.unit)}</span>
            {" · "}
            {isNew ? "New product" : "From the SOR"}
            {item.requester?.name && ` · ${item.requester.name}`}
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          {actions ?? (
            <StatusBadge label={ITEM_STATUS_LABELS[item.status] || item.status} theme={ITEM_STATUS_THEME[item.status]} />
          )}
        </div>
      </div>

      {(replaces || replacedBy) && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Replace size={12} className="shrink-0" />
          {replaces ? `Substitute for ${replaces.name}` : `Replaced by ${replacedBy.name}`}
        </p>
      )}

      {item.po_number && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="requested-item-po">
          <FileText size={12} className="shrink-0" />
          <span className="font-semibold text-foreground">PO {item.po_number}</span>
          <span>· {PO_VERIFICATION_LABELS[item.po_verification] || item.po_verification}</span>
          {lines.length > 0 && <span>· {lines.length === 1 ? "PO line" : "PO lines"} {lines.join(", ")}</span>}
        </p>
      )}
      {poLineNotPicked(item) && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle size={12} className="shrink-0" />
          PO line not picked
        </p>
      )}

      {stock && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <StatusBadge label={stock.badge.label} theme={STOCK_BADGE_THEME[stock.badge.kind]} />
          {stock.fetchedAt && <span>Stock as of {formatDate(stock.fetchedAt)}</span>}
          {stock.stale && <span className="font-medium text-amber-600 dark:text-amber-400">Stale</span>}
        </div>
      )}

      {change && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle size={12} className="shrink-0" />
          {change.label}
        </p>
      )}

      {item.description && (
        <div className="mt-0.5 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-line break-words">
          {item.description}
        </div>
      )}
      {item.images?.length > 0 && <AttachmentEvidence attachments={item.images} />}
    </li>
  );
}
