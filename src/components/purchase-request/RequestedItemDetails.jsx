import { AlertTriangle, Calculator, Replace } from "lucide-react";

import DetailGrid from "@/components/record/DetailGrid";
import StatusBadge from "../StatusBadge";
import StaleStockBadge from "./StaleStockBadge";
import { AttachmentEvidence } from "../ui/AttachmentEvidence";
import { PO_VERIFICATION_LABELS, REQUEST_PURPOSES } from "../../constants/procurement";
import { STOCK_BADGE_THEME } from "../../constants/stock";
import { formatDate } from "../../utils/formatDate";
import { stockWarning } from "../../constants/purchaseRequest";
import { componentLabel, isFromS0, itemSectionLabel, poLineNotPicked } from "../../utils/requestedItem";
import { deliveryNote } from "../../utils/deliveryNote";

/** "PHP 250.50" — the price a Canvass winner gave the item (#582). */
const formatPrice = ({ unitPrice, currency }) =>
  `${currency || "PHP"} ${unitPrice.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Warn = ({ children }) => (
  <span className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
    <AlertTriangle size={14} className="shrink-0" />
    {children}
  </span>
);

/** An opened item: its fields in the detail grid (uppercase labels over values), then its images. */
export default function RequestedItemDetails({ item, stock, replaces, replacedBy }) {
  const removed = isFromS0(item) && item.removed_from_s0 === true;
  const lines = item.odoo_po_line_ids || [];
  const component = componentLabel(item);
  const warning = stockWarning(item);

  const fields = [
    stock && {
      label: "Stock",
      value: (
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge label={stock.figure} theme={STOCK_BADGE_THEME[stock.badge.kind]} />
          {stock.fetchedAt && <span>read {formatDate(stock.fetchedAt)}</span>}
          {stock.stale && <StaleStockBadge />}
        </span>
      ),
    },
    {
      label: "Requested by",
      value: (
        <>
          {item.requester?.name || "Unknown"}
          {item.created_at && <span className="text-muted-foreground"> · {formatDate(item.created_at)}</span>}
        </>
      ),
    },
    { label: "Source", value: itemSectionLabel(item) },
    warning && { label: "Stock", value: <Warn>{warning.label}</Warn> },
    // #684: what Sales asked for, and what the attached P0 bought, when they differ.
    item.po_number && item.bought_as && { label: "Asked as", value: item.name },
    item.po_number && item.bought_as && { label: "Bought as", value: <span data-testid="requested-item-bought-as">{item.bought_as}</span> },
    !isFromS0(item) && item.purpose && {
      label: "For",
      value: REQUEST_PURPOSES.find((p) => p.value === item.purpose)?.label || item.purpose,
    },
    removed && { label: "S0", value: <Warn>Removed from S0</Warn> },
    component && {
      label: "Component",
      value: (
        <span className="flex items-center gap-1.5" data-testid="requested-item-component">
          <Calculator size={14} className="shrink-0 text-muted-foreground" />
          {component}
        </span>
      ),
    },
    item.price && {
      label: "Price",
      value: (
        <span data-testid="requested-item-price">
          <span className="font-semibold">{formatPrice(item.price)}</span> each
        </span>
      ),
    },
    (item.po_number || poLineNotPicked(item)) && {
      label: "Purchase order",
      value: (
        <span className="flex flex-col gap-1">
          {item.po_number && (
            <span data-testid="requested-item-po">
              <span className="font-semibold">{item.po_number}</span>
              <span> · {PO_VERIFICATION_LABELS[item.po_verification] || item.po_verification}</span>
              {item.po_state === "rfq" && <span> · RFQ, not confirmed yet</span>}
              {deliveryNote(item) && <span data-testid="requested-item-delivery"> · {deliveryNote(item)}</span>}
              {lines.length > 0 && (
                <span>
                  {" "}
                  · {lines.length === 1 ? "PO line" : "PO lines"} {lines.join(", ")}
                </span>
              )}
            </span>
          )}
          {poLineNotPicked(item) && <Warn>PO line not picked</Warn>}
        </span>
      ),
    },
    (replaces || replacedBy) && {
      label: "Substitute",
      value: (
        <span className="flex items-center gap-1.5">
          <Replace size={14} className="shrink-0 text-muted-foreground" />
          {replaces ? `Substitute for ${replaces.name}` : `Replaced by ${replacedBy.name}`}
        </span>
      ),
    },
    item.description && { label: "Notes", value: <span className="whitespace-pre-line">{item.description}</span> },
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <DetailGrid items={fields} />
      {item.images?.length > 0 && <AttachmentEvidence attachments={item.images} />}
    </div>
  );
}

