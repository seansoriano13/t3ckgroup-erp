import { AlertTriangle, Calculator, Replace } from "lucide-react";

import DetailGrid from "@/components/record/DetailGrid";
import StatusBadge from "../StatusBadge";
import StaleStockBadge from "./StaleStockBadge";
import { AttachmentEvidence } from "../ui/AttachmentEvidence";
import { PO_VERIFICATION_LABELS } from "../../constants/procurement";
import { STOCK_BADGE_THEME } from "../../constants/stock";
import { formatDate } from "../../utils/formatDate";
import { stockWarning } from "../../constants/purchaseRequest";
import { componentLabel, isFromS0, itemSectionLabel, poLineNotPicked, replacedNote, s0StillListsNote } from "../../utils/requestedItem";
import { askedByText, purposeLabel, splitProductName } from "../../utils/productLine";

/** "PHP 250.50" — the price a Canvass winner gave the item (#582). */
const formatPrice = ({ unitPrice, currency }) =>
  `${currency || "PHP"} ${unitPrice.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Warn = ({ children }) => (
  <span className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
    <AlertTriangle size={14} className="shrink-0" />
    {children}
  </span>
);

/**
 * An opened item: its fields in the detail grid (uppercase labels over values), then its images and
 * `buttons` (Canvass, Attach P0, Replace). The prototype's fields come first (#695): Stock, Odoo code,
 * P0, Price each; an Other request says who asked and what for, a merged line the request it took.
 * `side` is the requester's side on the request; `mergedFrom` the request that moved onto this line.
 */
export default function RequestedItemDetails({ item, stock, costText, replaces, replacedBy, side = null, mergedFrom = null, buttons = null }) {
  const removed = isFromS0(item) && item.removed_from_s0 === true;
  const lines = item.odoo_po_line_ids || [];
  const component = componentLabel(item);
  const warning = stockWarning(item);

  const { code } = splitProductName(item.name);
  const fields = [
    isFromS0(item)
      ? stock && {
          label: "Stock",
          value: (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge label={stock.figure} theme={STOCK_BADGE_THEME[stock.badge.kind]} />
              {stock.fetchedAt && <span>read {formatDate(stock.fetchedAt)}</span>}
              {stock.stale && <StaleStockBadge />}
            </span>
          ),
        }
      : { label: "For", value: purposeLabel(item) ?? item.purpose ?? "—" },
    isFromS0(item) ? code && { label: "Odoo code", value: <span className="font-mono">{code}</span> } : { label: "Asked by", value: askedByText(item, side) },
    item.po_number && {
      label: "P0",
      value: (
        <span data-testid="requested-item-po" className="flex flex-col gap-1">
          <span className="font-mono">
            {item.po_number}
            {item.po_state === "rfq" ? " · RFQ only, not confirmed" : ` · ${PO_VERIFICATION_LABELS[item.po_verification] || item.po_verification}`}
          </span>
          {lines.length > 0 && (
            <span>
              {lines.length === 1 ? "PO line" : "PO lines"} {lines.join(", ")}
            </span>
          )}
        </span>
      ),
    },
    poLineNotPicked(item) && { label: "PO line", value: <Warn>PO line not picked</Warn> },
    item.price && {
      label: "Price each",
      value: (
        <span data-testid="requested-item-price">
          <span className="font-semibold">{formatPrice(item.price)}</span>
        </span>
      ),
    },
    // #686: Expected / Actual cost, passed only to a viewer whose cost tier reads costs.
    costText && { label: "Cost", value: <span data-testid="requested-item-cost">{costText}</span> },
    // #684: what Sales asked for, and what the attached P0 bought, when they differ.
    item.po_number && item.bought_as && isFromS0(item) && { label: "Asked as", value: item.name },
    item.po_number && item.bought_as && isFromS0(item) && { label: "Bought as", value: <span data-testid="requested-item-bought-as">{item.bought_as}</span> },
    // #724: the P0 was attached before the SOR reached the stage that opens buying.
    item.ordered_early_reason && {
      label: "Ordered early",
      value: <span data-testid="requested-item-ordered-early">{item.ordered_early_reason}</span>,
    },
    mergedFrom && { label: "Merged with", value: `Your request "${mergedFrom.name}"` },
    { label: "Source", value: itemSectionLabel(item) },
    isFromS0(item) && { label: "Requested by", value: <>{item.requester?.name || "Unknown"}{item.created_at && <span className="text-muted-foreground"> · {formatDate(item.created_at)}</span>}</> },
    warning && { label: "Stock", value: <Warn>{warning.label}</Warn> },
    removed && { label: "S0", value: <Warn>Removed from S0</Warn> },
    item.s0_still_lists && {
      label: "S0",
      value: <Warn>{s0StillListsNote(item)}</Warn>,
    },
    component && {
      label: "Component",
      value: (
        <span className="flex items-center gap-1.5" data-testid="requested-item-component">
          <Calculator size={14} className="shrink-0 text-muted-foreground" />
          {component}
        </span>
      ),
    },
    (replaces || replacedBy) && {
      label: "Substitute",
      value: (
        <span className="flex items-center gap-1.5">
          <Replace size={14} className="shrink-0 text-muted-foreground" />
          {replaces ? `Substitute for ${replaces.name}` : replacedNote(item, replacedBy)}
        </span>
      ),
    },
    item.description && { label: "Notes", value: <span className="whitespace-pre-line">{item.description}</span> },
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <DetailGrid items={fields} />
      {item.images?.length > 0 && <AttachmentEvidence attachments={item.images} />}
      {buttons}
    </div>
  );
}

