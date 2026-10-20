import { useEffect, useState } from "react";
import { AlertTriangle, Calculator, FileText, Replace } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/Tooltip";
import StatusBadge from "../StatusBadge";
import StaleStockBadge from "./StaleStockBadge";
import { AttachmentEvidence } from "../ui/AttachmentEvidence";
import { ITEM_STATUS_LABELS, ITEM_STATUS_THEME } from "../../constants/purchaseRequest";
import { PO_VERIFICATION_LABELS } from "../../constants/procurement";
import { STOCK_BADGE_THEME } from "../../constants/stock";
import { formatDate } from "../../utils/formatDate";
import {
  ITEM_SOURCE_LABEL,
  componentLabel,
  formatAmount,
  poLineNotPicked,
  requestedItemStock,
  sorLineChange,
} from "../../utils/requestedItem";

/**
 * The item's name, held to two lines: a long Odoo product name ends in an
 * ellipsis, shows in full on hover, and opens in full with "Show full name".
 */
function ItemName({ name }) {
  const [text, setText] = useState(null);
  const [cut, setCut] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!text || open) return undefined;
    const check = () => setCut(text.scrollHeight > text.clientHeight + 1);
    check();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(check);
    observer.observe(text);
    return () => observer.disconnect();
  }, [text, name, open]);

  return (
    <>
      <Tooltip content={cut && !open ? name : null} side="top" align="start" className="max-w-sm">
        <p
          ref={setText}
          className={cn("text-sm font-semibold text-foreground break-words leading-snug", !open && "line-clamp-2")}
          data-testid="requested-item-name"
        >
          {name}
        </p>
      </Tooltip>
      {cut && (
        <Button
          type="button"
          variant="link"
          size="xs"
          aria-expanded={open}
          className="h-auto px-0 text-muted-foreground"
          onClick={() => setOpen((was) => !was)}
        >
          {open ? "Show less" : "Show full name"}
        </Button>
      )}
    </>
  );
}

/** "PHP 250.50" — the price a Canvass winner gave the item (#582). */
const formatPrice = ({ unitPrice, currency }) =>
  `${currency || "PHP"} ${unitPrice.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
 * An item added from the Costing Matrix (#273) shows the Component it buys for as "1.2 · name".
 *
 * Once Ordered on a PO (#312): the PO number, what Odoo said about it, and the
 * PO line(s) picked — or "PO line not picked" until Purchasing picks them.
 */
export default function RequestedItemRow({ item, stockSnapshot, actions = null, canvass = null, replaces = null, replacedBy = null }) {
  const stock = requestedItemStock(item, stockSnapshot);
  const change = sorLineChange(item);
  const lines = item.odoo_po_line_ids || [];

  return (
    <li className="flex flex-col gap-2 py-3" data-testid="requested-item">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <ItemName name={item.name} />
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{formatAmount(item.quantity, item.unit)}</span>
            {" · "}
            {ITEM_SOURCE_LABEL[item.source] || "From the SOR"}
            {item.requester?.name && ` · ${item.requester.name}`}
            {item.price && (
              <span data-testid="requested-item-price">
                {" · "}
                <span className="font-semibold text-foreground">{formatPrice(item.price)}</span> each
              </span>
            )}
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          {actions ?? (
            <StatusBadge label={ITEM_STATUS_LABELS[item.status] || item.status} theme={ITEM_STATUS_THEME[item.status]} />
          )}
        </div>
      </div>

      {componentLabel(item) && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground" data-testid="requested-item-component">
          <Calculator size={12} className="shrink-0" />
          {componentLabel(item)}
        </p>
      )}

      {canvass}

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
          {stock.stale && <StaleStockBadge />}
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
