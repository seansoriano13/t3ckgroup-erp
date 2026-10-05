import { useId, useMemo } from "react";
import { CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import EmptyState from "../ui/EmptyState";
import { Button } from "../ui/button";
import { RetailOrderTable } from "./RetailOrderRow";
import { useToggleSet } from "../../hooks/useToggleSet";
import { formatPHP } from "../../constants/sor";
import { chaseList } from "../../utils/retailReport";
import { formatCount } from "../../utils/retailFormat";

/**
 * Who to chase for Order Income, and for how much: the Missing and Suspect
 * orders on screen, by Odoo salesperson. `orders` is whatever the Retail report
 * is showing — already narrowed to the time range and any filters — so this
 * section moves with them. Read-only; each order opens in Odoo, where the
 * salesperson fixes the Income Note.
 */
export default function IncomeChaseList({ orders }) {
  const headingId = useId();
  const [expanded, toggle] = useToggleSet();
  const list = useMemo(() => chaseList(orders), [orders]);

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        Missing / Suspect income
      </h3>
      <p className="mt-0.5 text-sm text-muted-foreground">
        By salesperson. Missing: no Order Income. Suspect: Order Income above the Order Amount, or a Marketplace
        Fee at least the Order Amount.
      </p>
      {list.count > 0 && (
        <p className="mt-1 text-sm font-semibold text-foreground">
          {`${formatCount(list.count)} to chase · ${formatPHP(list.orderAmount)} Order Amount`}
        </p>
      )}

      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
        {list.groups.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing to chase in this range" className="py-10" />
        ) : (
          <div className="divide-y divide-border">
            {list.groups.map((group) => {
              const isOpen = expanded.has(group.id);
              return (
                <div key={group.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-expanded={isOpen}
                    onClick={() => toggle(group.id)}
                    className="h-auto w-full justify-between rounded-none px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="text-sm font-bold text-foreground">
                        {group.salesperson ?? "No salesperson"}
                      </span>
                      <span className="text-xs text-muted-foreground">{group.count} to chase</span>
                    </div>
                    <span className="text-sm font-bold text-foreground">{formatPHP(group.orderAmount)}</span>
                  </Button>

                  {isOpen && (
                    <div className="bg-muted/10 px-4 pb-3">
                      <RetailOrderTable orders={group.orders} odoo />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
