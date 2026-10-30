import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QueryError from "@/components/ui/QueryError";
import { ChevronRight } from "lucide-react";

import Reveal from "@/components/record/Reveal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ReadyBar from "./ReadyBar";
import { isFolded, summarize } from "../../utils/productReadiness";
import { Image } from "@/components/ui/image";
import Spinner from "@/components/ui/Spinner";
import AddRequestedItems from "./AddRequestedItems";
import LinerList from "@/components/record/LinerList";
import RequestedItemDetails from "./RequestedItemDetails";
import RequestedItemActions from "./RequestedItemActions";
import LineButtons from "./LineButtons";
import { AskedSub, ColumnHeads, COLUMNS, ForCell, NotesCell, P0Cell, ProductCode, QtyCell, StockCell } from "./ProductLineCells";
import { YoursBadge } from "./YoursDialog";
import StatusBadge from "../StatusBadge";
import { isFromS0, isOpenWithoutOdooProduct, requestedItemStock } from "../../utils/requestedItem";
import { mergedRequestOf, splitProductName, thumbnailOf } from "../../utils/productLine";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { ITEM_STATUS_LABELS, ITEM_STATUS_THEME, MEMBER_SIDE, isClosedStatus } from "../../constants/purchaseRequest";
import { purchaseRequestKeys } from "./queryKeys";
import { useCostingMatrix } from "../costing/useCostingMatrix";
import { tierReadsCost } from "../../constants/costing";
import { costComparisonText } from "../../utils/costComparison";

/** The first column of an Other request: its photo, what was asked, and what the P0 bought. */
function askedMain(item) {
  const photo = thumbnailOf(item);
  const boughtAs = item.po_number && item.bought_as;
  // Plain text when there is nothing beside it, so the row can hold it to one line and show the full name on hover.
  if (!photo && !boughtAs) return item.name;
  return (
    <>
      {photo && (
        <Image src={photo.url} alt="" className="mr-2 inline-block size-6 rounded-md border border-border object-cover align-middle" />
      )}
      {boughtAs ? `Asked as: ${item.name}` : item.name}
    </>
  );
}

/**
 * One Requested Item (#305) as a row of the product list (#695, after the prototype of spec #675):
 * the name over the Odoo code (an Other request: what was asked over what was bought), then the
 * columns Qty, Stock (For on an Other request), Status, P0 and Delivery and notes. The status is
 * the menu (#306) when the viewer may change it, else a plain badge. The rest of the item opens in
 * place as a DetailGrid with the Purchasing buttons.
 *
 * `stockSnapshot` is the SOR's `sor_stock_snapshots` row. `replaces` / `replacedBy` are the items on
 * either end of a Buyer's substitute; `mergedFrom` is the request whose P0 moved onto this line.
 * An item for a Component shows it as "1.2 · name" in its details.
 */
function requestedItemRow({ item, stockSnapshot, side = null, costText = null, status, notes, buttons = null, replaces = null, replacedBy = null, mergedFrom = null }) {
  const stock = requestedItemStock(item, stockSnapshot);
  const asked = !isFromS0(item);
  // #807: an open line with no Odoo product says so under its name.
  const noOdooProduct = isOpenWithoutOdooProduct(item) ? (
    <span className="block w-fit">
      <StatusBadge label="No Odoo product" theme="amber" />
    </span>
  ) : null;
  return {
    key: item.id,
    testId: "requested-item",
    label: item.name,
    main: asked ? askedMain(item) : splitProductName(item.name).name,
    sub: (
      <>
        {asked ? <AskedSub item={item} side={side} /> : <ProductCode item={item} />}
        {noOdooProduct}
      </>
    ),
    subWrap: asked,
    actions: (
      <div className={cn("grid items-center gap-3", COLUMNS)}>
        <QtyCell item={item} />
        {asked ? <ForCell item={item} /> : <StockCell stock={stock} />}
        <span className="flex">{status}</span>
        <P0Cell item={item} />
        {notes}
      </div>
    ),
    children: (
      <RequestedItemDetails
        item={item}
        stock={stock}
        costText={costText}
        replaces={replaces}
        replacedBy={replacedBy}
        side={side}
        mergedFrom={mergedFrom}
        buttons={buttons}
      />
    ),
  };
}

/**
 * #680 - one foldable section. The header folds it shut; inside, finished lines (Available,
 * Received, Cancelled) fold into one "N done" row unless they carry a warning.
 */
function ItemSection({ section, rowFor, open, onOpenChange, sectionRef }) {
  const asked = section.key === "other";
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
        {rows.length === 0 ? (
          <LinerList label={section.title} empty={section.empty} rows={rows} />
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[64rem] overflow-hidden rounded-2xl border border-border bg-card">
              <ColumnHeads first={asked ? "What was asked" : "Product"} third={asked ? "For" : "Stock"} />
              <LinerList label={section.title} empty={section.empty} rows={rows} className="rounded-none border-0" />
            </div>
          </div>
        )}
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

  // Who asked, by side ("Asked by Sales", "Added by Purchasing"); the roster is shared with the request's members.
  const { data: members = [] } = useQuery({
    queryKey: purchaseRequestKeys.members(requestId),
    queryFn: () => purchaseRequestService.listMembers(requestId),
    enabled: !!requestId,
  });
  const sideOf = new Map(members.map((m) => [m.id, m.side]));

  const items = itemsQuery.data || [];
  // #686: Expected / Actual cost on a product line, read through the matrix so the viewer's cost tier decides.
  const { data: matrix } = useCostingMatrix(items.some((i) => i.component_id) ? request?.opportunity_id : null);
  const costByComponent = new Map();
  if (matrix && tierReadsCost(matrix.tier, "acquire_unit")) {
    for (const line of matrix.tenderLines ?? []) {
      for (const c of line.components ?? []) {
        const text = costComparisonText({ expected: c.acquire_unit, actual: c.p0_unit_price, quoted: c.p0_quoted_unit_price, currency: c.p0_currency, fromCanvass: c.fromCanvass?.acquire });
        if (text) costByComponent.set(c.id, text);
      }
    }
  }
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
  const rowFor = (item) => {
    const replacedBy = substituteOf.get(item.id);
    const statusBadge = <StatusBadge label={ITEM_STATUS_LABELS[item.status] || item.status} theme={ITEM_STATUS_THEME[item.status]} />;
    return requestedItemRow({
      item,
      stockSnapshot,
      side: sideOf.get(item.requested_by) ?? null,
      costText: item.component_id ? costByComponent.get(item.component_id) ?? null : null,
      replaces: byId.get(item.substitute_for_item_id),
      replacedBy,
      mergedFrom: mergedRequestOf(item, items),
      buttons: renderActions ? null : <LineButtons item={item} request={request} actor={actor} />,
      status: renderActions ? (
        <div className="flex items-center gap-2">
          {statusBadge}
          {renderActions(item)}
        </div>
      ) : (
        <RequestedItemActions item={item} request={request} actor={actor} />
      ),
      // #688: a new S0 line that may be the same product as an Other request already bought.
      notes: (
        <NotesCell
          item={item}
          replacedBy={replacedBy}
          yours={
            item.new_on_s0 ? (
              <YoursBadge
                item={item}
                other={byId.get(item.yours_item_id)}
                requestId={requestId}
                canAnswer={[MEMBER_SIDE.PURCHASING, MEMBER_SIDE.SALES].includes(actor?.side)}
              />
            ) : null
          }
        />
      ),
    });
  };

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
        <AddRequestedItems request={request} />
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
