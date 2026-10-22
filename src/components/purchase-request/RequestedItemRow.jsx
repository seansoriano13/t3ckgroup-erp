import { useId } from "react";
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Calculator, ChevronRight, Replace } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EASE, SPRING } from "./requestedItemGroups";
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


const DOT = {
  green: "bg-green-9",
  amber: "bg-amber-9",
  blue: "bg-blue-9",
  red: "bg-red-9",
  violet: "bg-violet-9",
  orange: "bg-orange-9",
  mauve: "bg-mauve-8",
};
const statusDot = (item) => DOT[ITEM_STATUS_THEME[item.status]] || DOT.mauve;

/** "PHP 250.50" — the price a Canvass winner gave the item (#582). */
const formatPrice = ({ unitPrice, currency }) =>
  `${currency || "PHP"} ${unitPrice.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Smooth open and close; goes still when the person prefers reduced motion. */
function Expand({ open, id, children }) {
  const still = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="expand"
          id={id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: still ? 0 : 0.24, ease: EASE }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** One labelled field of an opened row. The value wraps instead of being cut. */
function Field({ label, children, wide = false }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "sm:col-span-2")}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm leading-snug text-foreground">{children}</dd>
    </div>
  );
}

const Warn = ({ children }) => (
  <span className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
    <AlertTriangle size={14} className="shrink-0" />
    {children}
  </span>
);

/** The one quiet line under a name: the PO, else the stock, else where the item came from. */
function summaryOf(item, stock) {
  if (item.po_number) return `PO ${item.po_number}`;
  if (stock) return `Stock: ${stock.badge.label}`;
  return ITEM_SOURCE_LABEL[item.source] || "From the SOR";
}

/**
 * One Requested Item (#305) as a soft card row: status dot, name (two lines),
 * a one-line summary, quantity, status (the action slot) and a chevron. The
 * rest of the item shows when the row is opened: stock with the time it was
 * read, who requested it, its Canvass, PO, substitute, price, notes and images.
 *
 * `stockSnapshot` is the SOR's `sor_stock_snapshots` row. `actions` is a slot
 * for the status controls (#306). `replaces` / `replacedBy` are the items on
 * either end of a Buyer's substitute. `wide` puts the opened fields in two
 * columns; `open` / `onToggle` are the list's.
 *
 * An item added from the Costing Matrix (#273) shows the Component it buys for as "1.2 · name".
 * Once Ordered on a PO (#312): the PO number, what Odoo said about it, and the
 * PO line(s) picked — or "PO line not picked" until Purchasing picks them.
 */
export default function RequestedItemRow({
  item,
  stockSnapshot,
  actions = null,
  replaces = null,
  replacedBy = null,
  open = false,
  onToggle = () => {},
  wide = false,
}) {
  const panelId = useId();
  const stock = requestedItemStock(item, stockSnapshot);
  const change = sorLineChange(item);
  const lines = item.odoo_po_line_ids || [];
  const component = componentLabel(item);
  const summary = summaryOf(item, stock);

  return (
    <motion.li
      layout
      layoutId={item.id}
      transition={SPRING}
      className={cn(
        "rounded-xl border bg-card transition-colors",
        open ? "border-foreground/30 shadow-sm ring-1 ring-foreground/10" : "border-border/70 hover:border-border",
      )}
      data-open={open || undefined}
      data-testid="requested-item"
    >
      <div className="flex items-start gap-3 px-4 py-3.5 sm:gap-4 sm:px-5 sm:py-4">
        <Button
          type="button"
          variant="ghost"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? "Close" : "Open"} details of ${item.name}`}
          onClick={onToggle}
          className="h-auto min-w-0 flex-1 cursor-pointer items-start justify-start gap-3 whitespace-normal rounded-lg p-0 text-left font-normal hover:bg-transparent aria-expanded:bg-transparent focus-visible:outline-2 focus-visible:outline-ring sm:gap-4"
        >
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", statusDot(item))} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span
              className={cn("block break-words text-sm font-semibold leading-snug text-foreground", !open && "line-clamp-2")}
              data-testid="requested-item-name"
              title={item.name}
            >
              {item.name}
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground" data-testid="requested-item-summary">
              {summary}
            </span>
          </span>
          <span className="shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-foreground">
            {formatAmount(item.quantity, item.unit)}
          </span>
        </Button>
        <div className="shrink-0 pt-0.5">
          {actions ?? (
            <StatusBadge label={ITEM_STATUS_LABELS[item.status] || item.status} theme={ITEM_STATUS_THEME[item.status]} />
          )}
        </div>
        <ChevronRight
          size={16}
          aria-hidden="true"
          onClick={onToggle}
          className={cn("mt-1 shrink-0 cursor-pointer text-muted-foreground transition-transform", open && "rotate-90")}
        />
      </div>

      <Expand open={open} id={panelId}>
        <dl
          className={cn(
            "mx-4 grid grid-cols-1 gap-x-10 gap-y-4 border-t border-border/60 pb-5 pt-4 sm:mx-5",
            wide && "sm:grid-cols-2",
          )}
        >
          {stock ? (
            <Field label="Stock">
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge label={stock.badge.label} theme={STOCK_BADGE_THEME[stock.badge.kind]} />
                {stock.fetchedAt && <span>Stock as of {formatDate(stock.fetchedAt)}</span>}
                {stock.stale && <StaleStockBadge />}
              </span>
            </Field>
          ) : null}
          <Field label="Requested by">
            {item.requester?.name || "Unknown"}
            {item.created_at && <span className="text-muted-foreground"> · {formatDate(item.created_at)}</span>}
          </Field>
          <Field label="Source">{ITEM_SOURCE_LABEL[item.source] || "From the SOR"}</Field>
          {component && (
            <Field label="Component">
              <span className="flex items-center gap-1.5" data-testid="requested-item-component">
                <Calculator size={14} className="shrink-0 text-muted-foreground" />
                {component}
              </span>
            </Field>
          )}
          {item.price && (
            <Field label="Price">
              <span data-testid="requested-item-price">
                <span className="font-semibold">{formatPrice(item.price)}</span> each
              </span>
            </Field>
          )}
          {(item.po_number || poLineNotPicked(item)) && (
            <Field label="Purchase order">
              <span className="flex flex-col gap-1">
                {item.po_number && (
                  <span data-testid="requested-item-po">
                    <span className="font-semibold">{item.po_number}</span>
                    <span> · {PO_VERIFICATION_LABELS[item.po_verification] || item.po_verification}</span>
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
            </Field>
          )}
          {(replaces || replacedBy) && (
            <Field label="Substitute">
              <span className="flex items-center gap-1.5">
                <Replace size={14} className="shrink-0 text-muted-foreground" />
                {replaces ? `Substitute for ${replaces.name}` : `Replaced by ${replacedBy.name}`}
              </span>
            </Field>
          )}
          {change && (
            <Field label="SOR line" wide>
              <Warn>{change.label}</Warn>
            </Field>
          )}
          {item.description && (
            <Field label="Notes" wide>
              <span className="whitespace-pre-line">{item.description}</span>
            </Field>
          )}
          {item.images?.length > 0 && (
            <div className="min-w-0 sm:col-span-2">
              <AttachmentEvidence attachments={item.images} />
            </div>
          )}
        </dl>
      </Expand>
    </motion.li>
  );
}
