import { useQuery } from "@tanstack/react-query";
import QueryError from "@/components/ui/QueryError";
import { AlertTriangle } from "lucide-react";

import Spinner from "@/components/ui/Spinner";
import AddRequestedItems from "./AddRequestedItems";
import LinerList from "@/components/record/LinerList";
import RequestedItemDetails from "./RequestedItemDetails";
import RequestedItemActions from "./RequestedItemActions";
import StatusBadge from "../StatusBadge";
import { formatAmount, isFromS0, itemSectionLabel, requestedItemStock } from "../../utils/requestedItem";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import {
  ITEM_STATUS,
  ITEM_STATUS_LABELS,
  ITEM_STATUS_THEME,
  isClosedStatus,
} from "../../constants/purchaseRequest";
import { purchaseRequestKeys } from "./queryKeys";

/** The one quiet line under a name: the PO, else the stock, else which section it is in. */
function summaryOf(item, stock) {
  if (item.po_number) return item.po_state === "rfq" ? `RFQ ${item.po_number}` : `PO ${item.po_number}`;
  if (stock) return `Stock: ${stock.badge.label}`;
  return itemSectionLabel(item);
}

/**
 * One Requested Item (#305) as a LinerList row: its name over a one-line
 * summary (the PO, the stock, or where it came from), the quantity, and its
 * status, which is the status menu (#306) in `actions` or a plain badge. The
 * rest of the item opens in place as a DetailGrid.
 *
 * `stockSnapshot` is the SOR's `sor_stock_snapshots` row. `replaces` /
 * `replacedBy` are the items on either end of a Buyer's substitute.
 *
 * An item for a Component shows it as "1.2 · name".
 * Once Ordered on a PO (#312): the PO number, what Odoo said about it, and the
 * PO line(s) picked — or "PO line not picked" until Purchasing picks them.
 */
function requestedItemRow({ item, stockSnapshot, actions = null, replaces = null, replacedBy = null }) {
  const stock = requestedItemStock(item, stockSnapshot);
  // The S0 dropped this line: the item stays so a bought product is never lost, and says so.
  const removed = isFromS0(item) && item.removed_from_s0 === true;
  return {
    key: item.id,
    testId: "requested-item",
    main: item.name,
    label: item.name,
    sub: removed ? (
      <>
        {summaryOf(item, stock)}
        {" · "}
        <span className="inline-flex items-center gap-1 font-medium text-amber-11">
          <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
          Removed from S0
        </span>
      </>
    ) : (
      summaryOf(item, stock)
    ),
    quantity: formatAmount(item.quantity, item.unit),
    badge: { label: ITEM_STATUS_LABELS[item.status] || item.status, theme: ITEM_STATUS_THEME[item.status] },
    actions,
    children: <RequestedItemDetails item={item} stock={stock} replaces={replaces} replacedBy={replacedBy} />,
  };
}

/**
 * Issue #305 / #678 — a Purchase Request's products in two sections: "From the S0" (one item per
 * S0 line, made and kept in step by the database) and "Other requests" (items with no S0 line).
 * Each shows its status beside it; the way to add an Other request sits on top.
 * Self-contained, for the request view (#308) to mount: `request` needs `id`
 * and `opportunity_id`. Each row's action slot holds the status controls
 * (#306) for whatever the signed-in member may do; `renderActions(item)`
 * replaces them.
 */
export default function RequestedItems({ request, renderActions }) {
  const requestId = request?.id;

  const itemsQuery = useQuery({
    queryKey: purchaseRequestKeys.items(requestId),
    queryFn: () => purchaseRequestService.listItems(requestId),
    enabled: !!requestId,
  });
  const { data: stockSnapshot } = useQuery({
    queryKey: purchaseRequestKeys.stock(requestId),
    queryFn: () => purchaseRequestService.stockSnapshot(requestId),
    enabled: !!requestId && !!request?.opportunity_id,
  });

  const { data: actor } = useQuery({
    queryKey: purchaseRequestKeys.itemActor(requestId),
    queryFn: () => purchaseRequestService.itemActor(requestId),
    enabled: !!requestId && !renderActions,
  });

  const items = itemsQuery.data || [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const substituteOf = new Map(
    items
      .filter((i) => i.substitute_for_item_id)
      .map((i) => [i.substitute_for_item_id, i]),
  );
  const sections = [
    { key: "s0", title: "From the S0", list: items.filter(isFromS0), empty: "The S0 has no products yet." },
    { key: "other", title: "Other requests", list: items.filter((i) => !isFromS0(i)), empty: "No other requests." },
  ];
  const open = items.filter((i) => !isClosedStatus(i.status)).length;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Requested Items
          {items.length > 0 && (
            <span className="ml-2 text-xs font-medium text-muted-foreground">
              {open} open of {items.length}
            </span>
          )}
        </h3>
        <AddRequestedItems request={request} items={items} />
      </div>
      {itemsQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : itemsQuery.isError ? (
        <QueryError
          title="Couldn't load the items."
          onRetry={itemsQuery.refetch}
        />
      ) : (
        sections.map((section) => (
          <section
            key={section.key}
            aria-label={section.title}
            className="flex flex-col gap-1.5"
            data-testid={`requested-section-${section.key}`}
          >
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
              <span className="ml-2 font-medium normal-case tracking-normal">{section.list.length}</span>
            </h4>
            <LinerList
              label={section.title}
              empty={section.empty}
              rows={section.list.map((item) =>
                requestedItemRow({
                  item,
                  stockSnapshot,
                  replaces: byId.get(item.substitute_for_item_id),
                  replacedBy: substituteOf.get(item.id),
                  actions: renderActions ? (
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        label={ITEM_STATUS_LABELS[item.status] || item.status}
                        theme={ITEM_STATUS_THEME[item.status]}
                      />
                      {renderActions(item)}
                    </div>
                  ) : (
                    <RequestedItemActions item={item} request={request} actor={actor} />
                  ),
                }),
              )}
            />
          </section>
        ))
      )}
    </section>
  );
}
