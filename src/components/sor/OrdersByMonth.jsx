import { ChevronDown, ChevronRight, ShoppingBag } from "lucide-react";
import EmptyState from "../ui/EmptyState";
import { Button } from "../ui/button";
import { RetailOrderTable } from "./RetailOrderRow";
import { ARRIVAL_HIGHLIGHT_CLASS } from "../../hooks/useRetailArrivals";
import { useToggleSet } from "../../hooks/useToggleSet";
import { formatPHP } from "../../constants/sor";

/**
 * The month × Marketplace groups and the orders behind each. `groups` is the
 * result of `monthMarketplaceGroups`; `empty` the words from
 * `retailReportCopy`; `arrivals` the set from `useRetailArrivals`, so a group
 * (and its order rows) flash while an order is new. `searching` shows every
 * group open and locks the toggles: a search finds few orders, which should be
 * seen without a click.
 */
export default function OrdersByMonth({ groups, empty, arrivals, searching }) {
  const [expanded, toggle] = useToggleSet();

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-foreground">Orders by month</h3>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {groups.length === 0 ? (
          <EmptyState icon={ShoppingBag} title={empty.title} description={empty.description} />
        ) : (
          <div className="divide-y divide-border">
            {groups.map((group) => {
              // A search shows its orders without a click; the months stay open meanwhile.
              const isOpen = searching || expanded.has(group.id);
              return (
                <div key={group.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => toggle(group.id)}
                    disabled={searching}
                    data-arrived={group.orders.some((order) => arrivals.has(order.id)) || undefined}
                    className={`h-auto w-full justify-between rounded-none px-4 py-3 text-left disabled:opacity-100 ${ARRIVAL_HIGHLIGHT_CLASS}`}
                  >
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="text-sm font-bold text-foreground">{group.month}</span>
                      <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-bold text-muted-foreground">
                        {group.marketplace}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {group.orders.length} order{group.orders.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-foreground">{formatPHP(group.total)}</span>
                  </Button>

                  {isOpen && (
                    <div className="bg-muted/10 px-4 pb-3">
                      <RetailOrderTable orders={group.orders} salesperson arrivals={arrivals} />
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
