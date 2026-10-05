import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag } from "lucide-react";
import Spinner from "../ui/Spinner";
import TabGroup from "../ui/TabGroup";
import EmptyState from "../ui/EmptyState";
import { Input } from "../ui/input";
import MarketplaceBreakdown from "./MarketplaceBreakdown";
import RetailHeadline from "./RetailHeadline";
import OrdersByMonth from "./OrdersByMonth";
import IncomeChaseList from "./IncomeChaseList";
import { emptyCopy, scopeNote } from "./retailReportCopy";
import { retailOrdersQuery } from "../../services/retailOrderService";
import { useRetailArrivals } from "../../hooks/useRetailArrivals";
import {
  DEFAULT_RETAIL_FILTERS,
  RETAIL_RANGES,
  monthOverMonth,
  monthMarketplaceGroups,
  monthlySeries,
  applyFilters,
  isSearching,
  rangeBounds,
  summarize,
} from "../../utils/retailReport";

/** Retail's time range: the header's action slot on the Retail page. */
export function RetailRangeControl({ range, onRangeChange, custom, onCustomChange }) {
  return (
    <>
      {range === "custom" && (
        <>
          <Input
            type="date"
            aria-label="From date"
            value={custom.from}
            max={custom.to || undefined}
            onChange={(e) => onCustomChange((c) => ({ ...c, from: e.target.value }))}
            containerClassName="w-40"
          />
          <Input
            type="date"
            aria-label="To date"
            value={custom.to}
            min={custom.from || undefined}
            onChange={(e) => onCustomChange((c) => ({ ...c, to: e.target.value }))}
            containerClassName="w-40"
          />
        </>
      )}
      <TabGroup
        tabs={RETAIL_RANGES}
        activeTab={range}
        onChange={onRangeChange}
        size="sm"
        className="max-w-full"
      />
    </>
  );
}

/**
 * The Retail report — sales from Shopee/Lazada, read from `retail_orders`
 * (synced from Odoo). Read-only: retail orders are entered in Odoo, have no
 * stages, and stay out of the SOR pipeline and commission. The time range is
 * the Page's: `RetailRangeControl` sits in the header, this takes its value.
 * So are the filters (`RetailFilterBar`, in the toolbar).
 */
export default function RetailReport({ range, custom, filters = DEFAULT_RETAIL_FILTERS }) {
  const {
    data: orders = [],
    isLoading,
    isError,
  } = useQuery(retailOrdersQuery);

  // The sync writes new orders on its own; this refetches when it does and
  // names the ones that just landed so the rows below can flash.
  const arrivals = useRetailArrivals(orders, !isLoading && !isError);

  // The counted orders in the range that pass every filter: the one list every
  // figure and block below reads (headline, Missing line, chart, month groups,
  // breakdown and chase list), so they all follow the same controls.
  const inRange = useMemo(
    () => applyFilters(orders, filters, rangeBounds(range, new Date(), custom)),
    [orders, filters, range, custom],
  );
  const summary = useMemo(() => summarize(inRange), [inRange]);
  const series = useMemo(() => monthlySeries(inRange), [inRange]);
  const groups = useMemo(() => monthMarketplaceGroups(inRange), [inRange]);
  // "This month" ignores the date range (are we up or down is not a range
  // question) but follows the filters like everything else.
  const mom = useMemo(() => monthOverMonth(applyFilters(orders, filters)), [orders, filters]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Spinner size="sm" />
        <span className="text-sm">Loading retail orders…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="Couldn't load retail orders"
        description="Refresh the page to try again."
        className="py-24"
      />
    );
  }

  const empty = emptyCopy(filters);

  return (
    <div className="space-y-8">
      <RetailHeadline summary={summary} mom={mom} series={series} scope={scopeNote(filters)} empty={empty} searching={isSearching(filters)} />

      <MarketplaceBreakdown orders={inRange} />

      {/* A Marketplace Order ID search sets the range aside (see `applyFilters`)
          and finds few orders: say so, and open the months holding them. */}
      <OrdersByMonth groups={groups} empty={empty} arrivals={arrivals} searching={isSearching(filters)} />

      <IncomeChaseList orders={inRange} />
    </div>
  );
}
