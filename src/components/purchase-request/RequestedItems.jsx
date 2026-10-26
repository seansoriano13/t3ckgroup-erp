import { useQuery } from "@tanstack/react-query";
import QueryError from "@/components/ui/QueryError";
import { AlertTriangle, PackageSearch } from "lucide-react";

import EmptyState from "@/components/ui/EmptyState";
import Spinner from "@/components/ui/Spinner";
import AddRequestedItems from "./AddRequestedItems";
import UnrequestedSorLinesHint from "./UnrequestedSorLinesHint";
import LinerList from "@/components/record/LinerList";
import RequestedItemDetails from "./RequestedItemDetails";
import { groupItems } from "./requestedItemGroups";
import RequestedItemActions from "./RequestedItemActions";
import StatusBadge from "../StatusBadge";
import { ITEM_SOURCE_LABEL, formatAmount, requestedItemStock, sorLineChange, SOR_LINE_CHANGE } from "../../utils/requestedItem";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import {
  ITEM_STATUS,
  ITEM_STATUS_LABELS,
  ITEM_STATUS_THEME,
  isClosedStatus,
} from "../../constants/purchaseRequest";
import { purchaseRequestKeys } from "./queryKeys";

/** The one quiet line under a name: the PO, else the stock, else where the item came from. */
function summaryOf(item, stock) {
  if (item.po_number) return `PO ${item.po_number}`;
  if (stock) return `Stock: ${stock.badge.label}`;
  return ITEM_SOURCE_LABEL[item.source] || "From the SOR";
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
 * An item added from the Costing Matrix (#273) shows the Component it buys for as "1.2 · name".
 * Once Ordered on a PO (#312): the PO number, what Odoo said about it, and the
 * PO line(s) picked — or "PO line not picked" until Purchasing picks them.
 */
function requestedItemRow({ item, stockSnapshot, actions = null, replaces = null, replacedBy = null }) {
  const stock = requestedItemStock(item, stockSnapshot);
  // A closed item keeps what was asked, so it carries no flag in the list.
  const change = isClosedStatus(item.status) ? null : sorLineChange(item);
  return {
    key: item.id,
    testId: "requested-item",
    main: item.name,
    label: item.name,
    sub: change ? (
      <>
        {summaryOf(item, stock)}
        {" · "}
        <span className="inline-flex items-center gap-1 font-medium text-amber-11">
          <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
          {change.kind === SOR_LINE_CHANGE.REMOVED ? "SOR line removed" : "SOR changed"}
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
 * Issue #305 — a Purchase Request's Requested Items, and the way to add more.
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
  const groups = groupItems(items);
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
      {items.length > 0 && <UnrequestedSorLinesHint request={request} items={items} />}

      {itemsQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : itemsQuery.isError ? (
        <QueryError
          title="Couldn't load the items."
          onRetry={itemsQuery.refetch}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Nothing requested yet"
          description="Whoever may request items adds what needs buying: a line from the SOR's Product List, or a new product."
          className="py-10"
        />
      ) : (
        <LinerList
          label="Requested Items"
          groups={groups.map((g) => ({
            key: g.key,
            title: g.label,
            count: g.list.length,
            testId: `requested-group-${g.key}`,
            rows: g.list.map((item) =>
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
            ),
          }))}
        />
      )}
    </section>
  );
}
