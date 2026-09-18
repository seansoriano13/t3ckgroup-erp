import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ShoppingBag, Package } from "lucide-react";
import Spinner from "../ui/Spinner";
import { opportunityService } from "../../services/opportunityService";
import { formatPHP } from "../../constants/sor";

/**
 * Best-effort storefront label from a retail SOR's client name — the same
 * table row a Shopee/Lazada order was created from (issue #172's customer
 * match), grouped for display rather than re-matched here.
 */
function storefrontLabel(clientName) {
  if (!clientName) return "Other";
  const name = clientName.toLowerCase();
  if (name.includes("shopee")) return "Shopee";
  if (name.includes("lazada")) return "Lazada";
  return clientName;
}

function monthKey(dateStr) {
  if (!dateStr) return "Unknown";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "long" });
}

/**
 * Issue #174 — a Retail tab querying the same table as the register with
 * the flag inverted: totals by month and storefront, with the individual
 * orders beneath so a surprising month can be explained.
 */
export default function RetailTab() {
  const [expanded, setExpanded] = useState(() => new Set());

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["retailOpportunities"],
    queryFn: () => opportunityService.getRetailOpportunities(),
  });

  const groups = useMemo(() => {
    const byGroup = new Map();
    for (const record of records) {
      const month = monthKey(record.registration_date);
      const storefront = storefrontLabel(record.client_name);
      const key = `${month}::${storefront}`;
      if (!byGroup.has(key)) {
        byGroup.set(key, { month, storefront, total: 0, orders: [] });
      }
      const group = byGroup.get(key);
      group.total += Number(record.expected_value) || 0;
      group.orders.push(record);
    }
    return Array.from(byGroup.values()).sort((a, b) => {
      if (a.month !== b.month) return b.month.localeCompare(a.month);
      return a.storefront.localeCompare(b.storefront);
    });
  }, [records]);

  const grandTotal = records.reduce((sum, r) => sum + (Number(r.expected_value) || 0), 0);

  const toggle = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <ShoppingBag size={15} className="text-muted-foreground" />
            Recorded orders
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Marketplace orders (issue #170) — excluded from the pipeline and commission, kept here for visibility.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total</p>
          <p className="text-lg font-bold text-foreground">{formatPHP(grandTotal)}</p>
        </div>
      </div>

      <div className="border border-border rounded-2xl overflow-hidden bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Spinner size="sm" />
            <span className="text-sm font-bold uppercase tracking-widest">Loading retail orders…</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <ShoppingBag size={28} className="opacity-40" />
            <p className="text-sm font-semibold">No retail orders yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {groups.map((group) => {
              const key = `${group.month}::${group.storefront}`;
              const isOpen = expanded.has(key);
              return (
                <div key={key}>
                  <button
                    onClick={() => toggle(key)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="text-sm font-bold text-foreground">{group.month}</span>
                      <span className="text-xs font-bold text-muted-foreground px-2 py-0.5 rounded-full bg-muted/40 border border-border">
                        {group.storefront}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {group.orders.length} order{group.orders.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-foreground">{formatPHP(group.total)}</span>
                  </button>

                  {isOpen && (
                    <div className="bg-muted/10 px-4 pb-3">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground uppercase tracking-wider">
                            <th className="text-left font-bold py-1.5">Reference</th>
                            <th className="text-left font-bold py-1.5">Item</th>
                            <th className="text-left font-bold py-1.5">Date</th>
                            <th className="text-right font-bold py-1.5">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.orders.map((order) => (
                            <tr key={order.id} className="border-t border-border/50">
                              <td className="py-1.5 font-mono font-bold text-foreground flex items-center gap-1.5">
                                <Package size={11} className="text-muted-foreground shrink-0" />
                                {order.sales_reference || "—"}
                              </td>
                              <td className="py-1.5 text-foreground">{order.project_title}</td>
                              <td className="py-1.5 text-muted-foreground">
                                {order.registration_date
                                  ? new Date(order.registration_date).toLocaleDateString("en-PH")
                                  : "—"}
                              </td>
                              <td className="py-1.5 text-right font-semibold text-foreground">
                                {formatPHP(order.expected_value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
