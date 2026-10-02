import { useId, useMemo, useState } from "react";
import { ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight, Package } from "lucide-react";
import EmptyState from "../ui/EmptyState";
import { Button } from "../ui/button";
import { ExternalLink } from "../ui/external-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import IncomeBadge from "./IncomeBadge";
import { formatPHP } from "../../constants/sor";
import { chaseList } from "../../utils/retailReport";
import { odooSaleOrderUrl } from "../../utils/odooLinks";

/**
 * Who to chase for Order Income, and for how much: the Missing and Suspect
 * orders on screen, by Odoo salesperson. `orders` is whatever the Retail report
 * is showing — already narrowed to the time range and any filters — so this
 * section moves with them. Read-only; each order opens in Odoo, where the
 * salesperson fixes the Income Note.
 */
export default function IncomeChaseList({ orders }) {
  const headingId = useId();
  const [expanded, setExpanded] = useState(() => new Set());
  const list = useMemo(() => chaseList(orders), [orders]);

  const toggle = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
          {`${list.count.toLocaleString("en-PH")} to chase · ${formatPHP(list.orderAmount)} Order Amount`}
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
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="py-1.5">Reference</TableHead>
                            <TableHead className="py-1.5">Marketplace Order ID</TableHead>
                            <TableHead className="py-1.5">Buyer</TableHead>
                            <TableHead className="py-1.5">Date</TableHead>
                            <TableHead className="py-1.5 text-right">Order Amount</TableHead>
                            <TableHead className="py-1.5 text-right">Marketplace Fee</TableHead>
                            <TableHead className="py-1.5 text-right">Order Income</TableHead>
                            <TableHead className="py-1.5">Income</TableHead>
                            <TableHead className="py-1.5">Odoo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.orders.map((order) => {
                            const odooUrl = odooSaleOrderUrl(order.odoo_so_id);
                            return (
                              <TableRow key={order.id} className="border-t border-border/50">
                                <TableCell className="flex items-center gap-1.5 py-1.5 font-mono font-bold text-foreground">
                                  <Package size={11} className="shrink-0 text-muted-foreground" />
                                  {order.odoo_so_number}
                                </TableCell>
                                <TableCell className="py-1.5 font-mono text-foreground">
                                  {order.marketplace_order_id || "—"}
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
                                <TableCell className="py-1.5 text-right text-foreground">
                                  {order.marketplace_fee == null ? "—" : formatPHP(order.marketplace_fee)}
                                </TableCell>
                                <TableCell className="py-1.5 text-right font-semibold text-foreground">
                                  {order.order_income == null ? "—" : formatPHP(order.order_income)}
                                </TableCell>
                                <TableCell className="py-1.5">
                                  <IncomeBadge order={order} />
                                </TableCell>
                                <TableCell className="py-1.5">
                                  {odooUrl ? (
                                    <ExternalLink
                                      href={odooUrl}
                                      className="inline-flex items-center gap-0.5 whitespace-nowrap font-semibold text-foreground underline-offset-2 hover:underline"
                                    >
                                      Open in Odoo
                                      <span className="sr-only"> {order.odoo_so_number}</span>
                                      <ArrowUpRight aria-hidden size={12} />
                                    </ExternalLink>
                                  ) : (
                                    "—"
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
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
    </section>
  );
}
