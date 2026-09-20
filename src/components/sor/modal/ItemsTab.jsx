import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Download, PackageSearch, RefreshCw, Search } from "lucide-react";
import Spinner from "../../ui/Spinner";
import StatusBadge from "../../StatusBadge";
import OpportunityItemsEditor from "../OpportunityItemsEditor";
import TabSkeleton from "./TabSkeleton";
import { useSorModalData } from "./useSorModalData";
import { opportunityService } from "../../../services/opportunityService";
import { stockBadge, STOCK_BADGE_THEME } from "../../../constants/stock";
import { formatPHP, isValidSalesReference, normalizeSalesReference, SALES_REFERENCE_HINT } from "../../../constants/sor";
import { formatDate } from "../../../utils/formatDate";
import { pullOdooLines, saveOdooLines } from "./odooLines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function ItemStockRow({ item, snapshotData }) {
  const [expanded, setExpanded] = useState(false);
  const product = item.odoo_product_id ? snapshotData?.products?.[item.odoo_product_id] || null : null;
  const badge = stockBadge({ quantity: item.quantity, product });
  const warehouses = snapshotData?.warehouses || [];
  const canExpand = !!product && warehouses.length > 0;

  return (
    <div className="col-span-12 -mt-1">
      <Button
        type="button"
        onClick={() => canExpand && setExpanded((e) => !e)}
        variant="ghost" className={cn("h-auto justify-start p-0 flex items-center gap-1 text-left", canExpand ? "cursor-pointer" : "cursor-default")}
        disabled={!canExpand}
      >
        <StatusBadge label={badge.label} theme={STOCK_BADGE_THEME[badge.kind]} />
        {canExpand && (expanded ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />)}
      </Button>

      {expanded && canExpand && (
        <div className="mt-2 grid grid-cols-4 gap-2 rounded-lg bg-muted/30 px-3 py-2 text-[11px]">
          <span className="col-span-4 font-bold tracking-widest text-muted-foreground uppercase text-[9px]">By warehouse</span>
          {warehouses.map((w) => {
            const wh = product.byWarehouse?.[w.id];
            return (
              <div key={w.id} className="col-span-4 grid grid-cols-4 gap-2">
                <span className="col-span-1 font-medium text-foreground truncate">{w.name}</span>
                <span className="text-right text-muted-foreground">On hand {wh?.onHand ?? 0}</span>
                <span className="text-right text-muted-foreground">Free {wh?.free ?? 0}</span>
                <span className="text-right text-muted-foreground">Forecast {wh?.forecast ?? 0}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The two ways a Product List can be empty are different problems with
 * different next steps (#301): with a Sales Reference there is a quotation
 * in Odoo to pull from, without one there is nothing to pull yet.
 */
function EmptyItems({ opportunity, onFetch, fetching }) {
  const hasSalesReference = !!opportunity?.sales_reference;

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <PackageSearch size={28} className="text-muted-foreground/50" />
      {hasSalesReference ? (
        <>
          <p className="text-sm font-semibold text-foreground">No products on this SOR yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Pull the lines from <span className="font-mono font-semibold text-primary">{opportunity.sales_reference}</span> in Odoo.
          </p>
          <Button
            type="button"
            onClick={onFetch}
            disabled={fetching}
            variant="default" className="mt-1"
          >
            {fetching ? <Spinner size="sm" /> : <Download size={14} />}
            Fetch from Odoo
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-foreground">Add a Sales Reference first</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            The Product List comes from the Odoo quotation. Add this SOR&apos;s Sales Reference in Details to pull it.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Items (#301) — the Product List in its own tab, so a 157-line list (the
 * worst case on staging) scrolls against its own header instead of pushing
 * the rest of the modal down the page. Search is client-side: the whole list
 * is already in memory, and a round trip per keystroke would be slower than
 * filtering it.
 *
 * The Product List and its stock snapshot both wait for this tab to open
 * (#298's lazy-fetch-once pattern). The list's query lives on the shell
 * because edit mode needs it too — see `handleEditToggle`.
 */
export default function ItemsTab({ ctx, hasOpened }) {
  const {
    opportunity,
    id,
    items,
    itemsLoading,
    isEditing,
    editForm,
    setEditForm,
    user,
    invalidate,
    autoSyncingOdoo,
    handleRefreshStock,
    refreshingStock,
    accessLevel,
  } = ctx;

  // ADR 0021 / #297: `sor_participant_items` carries no unit_price column at
  // all, so a Participant's Product List shows quantities without prices or
  // line totals — not those figures hidden by the screen.
  const showMoney = accessLevel !== "participant";

  const [search, setSearch] = useState("");

  const { data: stockSnapshot, isLoading } = useSorModalData({
    tab: "items",
    opportunityId: id,
    queryFn: () => opportunityService.getStockSnapshot(id),
    hasOpened,
  });

  // The empty state's Fetch from Odoo (#301). Unlike the edit form's Fetch
  // Items, there is no form open to hold the lines until a Save, so they go
  // straight to the SOR — and with nothing on the list, nothing is replaced.
  const pullMutation = useMutation({
    mutationFn: async () => {
      const ref = normalizeSalesReference(opportunity.sales_reference);
      if (!isValidSalesReference(ref)) throw new Error(SALES_REFERENCE_HINT);
      const { problem, rows, stock, quotation } = await pullOdooLines(ref);
      if (problem) throw new Error(problem);
      await saveOdooLines({ opportunity, rows, stock, actorId: user?.id });
      return { count: rows.length, quotation };
    },
    onSuccess: ({ count, quotation }) => {
      invalidate();
      toast.success(`Pulled ${count} item(s) from ${quotation}.`);
    },
    onError: (err) => toast.error(err.message || "Could not reach Odoo — enter items manually."),
  });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (it) => (it.product_name || "").toLowerCase().includes(term) || (it.unit || "").toLowerCase().includes(term),
    );
  }, [items, search]);

  const total = visible.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  const isSyncing = autoSyncingOdoo || pullMutation.isPending;

  if (isEditing) {
    return (
      <div className="p-6">
        <OpportunityItemsEditor items={editForm.items || []} onChange={(newItems) => setEditForm((f) => ({ ...f, items: newItems }))} />
      </div>
    );
  }

  if (isLoading || itemsLoading) return <TabSkeleton />;

  if (!items.length && !isSyncing) {
    return <EmptyItems opportunity={opportunity} onFetch={() => pullMutation.mutate()} fetching={pullMutation.isPending} />;
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {isSyncing && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <Spinner size="md" className="text-primary" />
        </div>
      )}

      <div className="shrink-0 border-b border-border/60 bg-card">
        <div className="flex flex-wrap items-center gap-2 px-6 py-3">
          <div className="relative min-w-[180px] flex-1">
            <Search size={13} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              aria-label="Search products"
              className="h-9" containerClassName="w-full"
            />
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
            {search.trim() ? `${visible.length} of ${items.length}` : `${items.length} item${items.length === 1 ? "" : "s"}`}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {stockSnapshot?.fetched_at ? `Stock as of ${formatDate(stockSnapshot.fetched_at)}` : "Stock not yet checked"}
          </span>
          <Button
            type="button"
            onClick={handleRefreshStock}
            disabled={refreshingStock}
            variant="link"
          >
            {refreshingStock ? <Spinner size="sm" /> : <RefreshCw size={12} />}
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-12 gap-3 border-t border-border/60 bg-muted/40 px-6 py-2.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
          <span className={showMoney ? "col-span-6" : "col-span-10"}>Product &amp; Unit</span>
          <span className="col-span-2 text-right">Quantity</span>
          {showMoney && (
            <>
              <span className="col-span-2 text-right">Unit Price</span>
              <span className="col-span-2 text-right">Line Total</span>
            </>
          )}
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">No product matches that search.</p>
        ) : (
          visible.map((it) => (
            <div key={it.id} className="grid grid-cols-12 items-center gap-3 px-6 py-3 text-sm transition-colors hover:bg-muted/25">
              <div className={cn("min-w-0 pr-2", showMoney ? "col-span-6" : "col-span-10")}>
                <span className="block truncate font-semibold text-foreground">{it.product_name}</span>
                {it.unit && <span className="mt-0.5 inline-block text-[11px] font-medium text-muted-foreground">Unit: {it.unit}</span>}
              </div>
              <div className="col-span-2 text-right">
                <span className="inline-block rounded-md bg-mauve-3 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-foreground">
                  {it.quantity} {it.unit ? "" : "qty"}
                </span>
              </div>
              {showMoney && (
                <>
                  <span className="col-span-2 text-right font-medium tabular-nums text-muted-foreground">{formatPHP(it.unit_price)}</span>
                  <span className="col-span-2 text-right font-bold tabular-nums text-foreground">
                    {formatPHP(Number(it.quantity) * Number(it.unit_price))}
                  </span>
                </>
              )}
              <ItemStockRow item={it} snapshotData={stockSnapshot?.data} />
            </div>
          ))
        )}
      </div>

      {showMoney && (
        <div className="grid shrink-0 grid-cols-12 items-center gap-3 border-t border-border/80 bg-muted/30 px-6 py-3 text-sm">
          <span className="col-span-8 text-right text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            {search.trim() ? "Filtered Line Total" : "Product Line Total"}
          </span>
          <span className="col-span-4 text-right text-base font-black tabular-nums text-foreground">{formatPHP(total)}</span>
        </div>
      )}
    </div>
  );
}
