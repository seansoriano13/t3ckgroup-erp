import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  ChevronDown,
  ChevronRight,
  Package,
  Receipt,
  ShoppingBag,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Spinner from "../ui/Spinner";
import TabGroup from "../ui/TabGroup";
import StatCard from "../StatCard";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getRetailOrders } from "../../services/retailOrderService";
import { formatPHP } from "../../constants/sor";
import {
  RETAIL_RANGES,
  monthOverMonth,
  monthStorefrontGroups,
  monthlySeries,
  ordersInRange,
  rangeBounds,
  summarize,
} from "../../utils/retailReport";

// Neutral, solid shades (not opacity, which the legend swatch would not show),
// so the report matches the commission dashboard and each storefront is
// told apart in the legend.
const SERIES_FILLS = [
  "var(--color-foreground, #222)",
  "var(--color-muted-foreground, #888)",
  "var(--color-border, #bbb)",
  "var(--color-muted, #ddd)",
];

/** "₱120K" / "₱1.2M" for a y-axis tick; full pesos would be wider than the axis. */
function formatAxisPeso(value) {
  const n = Number(value) || 0;
  if (n >= 1e6) return `₱${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `₱${+(n / 1e3).toFixed(0)}K`;
  return `₱${n}`;
}

function monthOverMonthSubtitle({ lastMonth, deltaPct }) {
  if (deltaPct === null) return lastMonth === 0 ? "Nothing to compare with last month" : "vs last month";
  const arrow = deltaPct >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(deltaPct).toFixed(0)}% vs last month (${formatPHP(lastMonth)})`;
}

/**
 * The Retail report — sales from Shopee/Lazada, read from `retail_orders`
 * (synced from Odoo). Read-only: retail orders are entered in Odoo, have no
 * stages, and stay out of the SOR pipeline and commission.
 */
export default function RetailReport() {
  const [range, setRange] = useState("3m");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [expanded, setExpanded] = useState(() => new Set());

  const {
    data: orders = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["retailOrders"],
    queryFn: getRetailOrders,
  });

  const inRange = useMemo(
    () => ordersInRange(orders, rangeBounds(range, new Date(), custom)),
    [orders, range, custom],
  );
  const summary = useMemo(() => summarize(inRange), [inRange]);
  const series = useMemo(() => monthlySeries(inRange), [inRange]);
  const groups = useMemo(() => monthStorefrontGroups(inRange), [inRange]);
  const mom = useMemo(() => monthOverMonth(orders), [orders]);

  const toggle = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Spinner size="sm" />
        <span className="text-sm font-bold uppercase tracking-widest">Loading retail orders…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-muted-foreground">
        <ShoppingBag size={28} className="opacity-40" />
        <p className="text-sm font-semibold text-foreground">Couldn&apos;t load retail orders</p>
        <p className="text-xs">Refresh the page to try again.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <ShoppingBag size={15} className="text-muted-foreground" />
            Retail overview
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Marketplace orders synced from Odoo — kept out of the pipeline and commission.
          </p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-end gap-3">
          {range === "custom" && (
            <>
              <Input
                type="date"
                aria-label="From date"
                value={custom.from}
                max={custom.to || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                containerClassName="w-40"
              />
              <Input
                type="date"
                aria-label="To date"
                value={custom.to}
                min={custom.from || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                containerClassName="w-40"
              />
            </>
          )}
          <TabGroup
            tabs={RETAIL_RANGES}
            activeTab={range}
            onChange={setRange}
            size="sm"
            className="max-w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total sales"
          value={formatPHP(summary.total)}
          subtitle="In the selected range"
          icon={<Wallet size={18} className="text-muted-foreground" />}
          color="emerald"
        />
        <StatCard
          title="Orders"
          value={summary.count.toLocaleString("en-PH")}
          subtitle="In the selected range"
          icon={<ShoppingBag size={18} className="text-muted-foreground" />}
          color="blue"
        />
        <StatCard
          title="Average order"
          value={formatPHP(summary.average)}
          subtitle="Total ÷ orders"
          icon={<Receipt size={18} className="text-muted-foreground" />}
          color="violet"
        />
        <StatCard
          title="This month"
          value={formatPHP(mom.thisMonth)}
          subtitle={monthOverMonthSubtitle(mom)}
          icon={<TrendingUp size={18} className="text-muted-foreground" />}
          color="amber"
        />
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-widest text-foreground">Monthly sales</h3>
        <p className="mb-4 mt-1 text-[11px] text-muted-foreground">By storefront, for the selected range.</p>
        {series.rows.length === 0 ? (
          <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-muted-foreground">
            <ShoppingBag size={28} className="opacity-40" />
            <p className="text-sm font-semibold">No retail orders in this range</p>
          </div>
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={100}
              minHeight={200}
              initialDimension={{ width: 600, height: 260 }}
            >
              <BarChart data={series.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground, #888)" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatAxisPeso}
                  width={56}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground, #888)" }}
                />
                <RechartsTooltip
                  formatter={(value) => formatPHP(value)}
                  cursor={{ fill: "var(--color-muted, #eee)", opacity: 0.4 }}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--color-border, #ddd)",
                    background: "var(--color-card, #fff)",
                    fontSize: 12,
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                {series.storefronts.map((storefront, index) => (
                  <Bar
                    key={storefront}
                    dataKey={storefront}
                    stackId="sales"
                    maxBarSize={44}
                    fill={SERIES_FILLS[index % SERIES_FILLS.length]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-foreground">Orders by month</h3>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <ShoppingBag size={28} className="opacity-40" />
              <p className="text-sm font-semibold">No retail orders in this range</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {groups.map((group) => {
                const isOpen = expanded.has(group.id);
                return (
                  <div key={group.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => toggle(group.id)}
                      className="h-auto w-full justify-between rounded-none px-4 py-3 text-left"
                    >
                      <div className="flex items-center gap-2">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="text-sm font-bold text-foreground">{group.month}</span>
                        <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-bold text-muted-foreground">
                          {group.storefront}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {group.orders.length} order{group.orders.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <span className="text-sm font-bold text-foreground">{formatPHP(group.total)}</span>
                    </Button>

                    {isOpen && (
                      <div className="bg-muted/10 px-4 pb-3">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="py-1.5">Reference</TableHead>
                              <TableHead className="py-1.5">Buyer</TableHead>
                              <TableHead className="py-1.5">Date</TableHead>
                              <TableHead className="py-1.5 text-right">Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.orders.map((order) => (
                              <TableRow key={order.id} className="border-t border-border/50">
                                <TableCell className="flex items-center gap-1.5 py-1.5 font-mono font-bold text-foreground">
                                  <Package size={11} className="shrink-0 text-muted-foreground" />
                                  {order.odoo_so_number}
                                </TableCell>
                                <TableCell className="py-1.5 text-foreground">{order.buyer_name || "—"}</TableCell>
                                <TableCell className="py-1.5 text-muted-foreground">
                                  {order.ordered_at
                                    ? new Date(order.ordered_at).toLocaleDateString("en-PH")
                                    : "—"}
                                </TableCell>
                                <TableCell className="py-1.5 text-right font-semibold text-foreground">
                                  {formatPHP(order.amount)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
