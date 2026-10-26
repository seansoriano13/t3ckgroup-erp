import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QueryError from "@/components/ui/QueryError";
import { AlertTriangle, ChevronRight } from "lucide-react";

import Reveal from "@/components/record/Reveal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ReadyBar from "./ReadyBar";
import { isFolded, summarize } from "../../utils/productReadiness";
import Spinner from "@/components/ui/Spinner";
import AddRequestedItems from "./AddRequestedItems";
import LinerList from "@/components/record/LinerList";
import RequestedItemDetails from "./RequestedItemDetails";
import RequestedItemActions from "./RequestedItemActions";
import ItemCanvass from "./ItemCanvass";
import StatusBadge from "../StatusBadge";
import { formatAmount, isFromS0, itemSectionLabel, requestedItemStock } from "../../utils/requestedItem";
import { deliveryNote } from "../../utils/deliveryNote";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import {
  ITEM_STATUS,
  ITEM_STATUS_LABELS,
  ITEM_STATUS_THEME,
  isClosedStatus,
  stockWarning,
} from "../../constants/purchaseRequest";
import { purchaseRequestKeys } from "./queryKeys";

/** The one quiet line under a name: the PO, else the stock, else which section it is in. */
function summaryOf(item, stock) {
  const warning = stockWarning(item);
  if (warning) return warning.label;
  if (item.po_number) {
    if (item.po_state === "rfq") return `RFQ ${item.po_number}`;
    const delivery = deliveryNote(item);
    return delivery ? `PO ${item.po_number} · ${delivery}` : `PO ${item.po_number}`;
  }
  if (stock) return `Stock: ${stock.figure}`;
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
function requestedItemRow({ item, stockSnapshot, actions = null, replaces = null, replacedBy = null, canvass = null }) {
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
    children: (
      <>
        <RequestedItemDetails item={item} stock={stock} replaces={replaces} replacedBy={replacedBy} />
        {canvass}
      </>
    ),
  };
}

/**
 * #680 - one foldable section. The header folds it shut; inside, finished lines (Available,
 * Received, Cancelled) fold into one "N done" row unless they carry a warning.
 */
function ItemSection({ section, rowFor, open, onOpenChange, sectionRef }) {
  const [showDone, setShowDone] = useState(false);
  const panelId = useId();
  const active = section.list.filter((i) => !isFolded(i));
  const folded = section.list.filter(isFolded);
  const rows = [
    ...active.map(rowFor),
    ...(showDone ? folded.map(rowFor) : []),
    ...(folded.length > 0
      ? [
          {
            key: `${section.key}-done`,
            testId: "done-row",
            main: `${folded.length} done`,
            sub: "Available, Received and Cancelled lines",
            actions: (
              <Button type="button" variant="link" size="sm" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
                {showDone ? "hide" : "show"}
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <section
      ref={sectionRef}
      aria-label={section.title}
      className="flex scroll-mt-4 flex-col gap-1.5 [&_.reveal[data-open='false']>*]:overflow-hidden!"
      data-testid={`requested-section-${section.key}`}
    >
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className="h-auto w-full justify-start gap-2 px-1 py-1.5 text-left hover:bg-muted/50"
      >
        <ChevronRight size={16} aria-hidden="true" className={cn("shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-90")} />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</span>
        <span className="text-xs font-medium text-muted-foreground">{section.list.length}</span>
      </Button>
      <Reveal open={open} id={panelId}>
        <LinerList label={section.title} empty={section.empty} rows={rows} />
      </Reveal>
    </section>
  );
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
  const [openSections, setOpenSections] = useState({ s0: true, other: true });
  const sectionRefs = { s0: useRef(null), other: useRef(null) };

  const itemsQuery = useQuery({
    queryKey: purchaseRequestKeys.items(requestId),
    queryFn: () => purchaseRequestService.listItems(requestId),
    enabled: !!requestId,
  });
  // Opening the request reads its P0s from Odoo once (#685); lines then show the stored values.
  const queryClient = useQueryClient();
  const hasP0 = (itemsQuery.data || []).some((i) => i.po_number);
  useQuery({
    queryKey: purchaseRequestKeys.p0Sync(requestId),
    queryFn: async () => {
      const result = await purchaseRequestService.syncP0s(requestId);
      if (result.ok) queryClient.invalidateQueries({ queryKey: purchaseRequestKeys.items(requestId) });
      return result;
    },
    enabled: !!requestId && hasP0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
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
  const jump = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: true }));
    sectionRefs[key].current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  const rowFor = (item) =>
    requestedItemRow({
      item,
      stockSnapshot,
      replaces: byId.get(item.substitute_for_item_id),
      replacedBy: substituteOf.get(item.id),
      canvass: renderActions ? null : <ItemCanvass item={item} request={request} actor={actor} />,
      actions: renderActions ? (
        <div className="flex items-center gap-2">
          <StatusBadge label={ITEM_STATUS_LABELS[item.status] || item.status} theme={ITEM_STATUS_THEME[item.status]} />
          {renderActions(item)}
        </div>
      ) : (
        <RequestedItemActions item={item} request={request} actor={actor} />
      ),
    });

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
        <>
          {items.length > 0 && (
            <ReadyBar
              summary={summarize(items)}
              jumps={sections.map((section) => ({
                key: section.key,
                label: section.title,
                count: section.list.length,
                onClick: () => jump(section.key),
              }))}
            />
          )}
          {sections.map((section) => (
            <ItemSection
              key={section.key}
              section={section}
              rowFor={rowFor}
              open={openSections[section.key]}
              onOpenChange={(v) => setOpenSections((prev) => ({ ...prev, [section.key]: v }))}
              sectionRef={sectionRefs[section.key]}
            />
          ))}
        </>
      )}
    </section>
  );
}
