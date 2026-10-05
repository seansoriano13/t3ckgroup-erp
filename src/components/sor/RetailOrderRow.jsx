import { ArrowUpRight, Package } from "lucide-react";
import { ExternalLink } from "../ui/external-link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import IncomeBadge from "./IncomeBadge";
import { ARRIVAL_HIGHLIGHT_CLASS } from "../../hooks/useRetailArrivals";
import { formatPHP } from "../../constants/sor";
import { odooSaleOrderUrl } from "../../utils/odooLinks";
import { BLANK, formatDateOrDash, formatPHPOrDash } from "../../utils/retailFormat";

/**
 * One Retail Order's cells. The report's month groups and the chase list show
 * the same order the same way; they differ only in an extra column each:
 * `salesperson` (the report) and `odoo` (the chase list, a link to fix the
 * Income Note). Pass `arrivals` (the set from `useRetailArrivals`) to flash the
 * row while the order is new.
 */
export default function RetailOrderRow({ order, salesperson = false, odoo = false, arrivals }) {
  const odooUrl = odoo ? odooSaleOrderUrl(order.odoo_so_id) : null;
  return (
    <TableRow
      data-arrived={arrivals?.has(order.id) || undefined}
      className={cn("border-t border-border/50", arrivals && ARRIVAL_HIGHLIGHT_CLASS)}
    >
      <TableCell className="flex items-center gap-1.5 py-1.5 font-mono font-bold text-foreground">
        <Package size={11} className="shrink-0 text-muted-foreground" />
        {order.odoo_so_number}
      </TableCell>
      <TableCell className="py-1.5 font-mono text-foreground">{order.marketplace_order_id || BLANK}</TableCell>
      <TableCell className="py-1.5 text-foreground">{order.buyer_name || BLANK}</TableCell>
      {salesperson && (
        <TableCell className="py-1.5 text-foreground">{order.odoo_salesperson_name || BLANK}</TableCell>
      )}
      <TableCell className="py-1.5 text-muted-foreground">{formatDateOrDash(order.ordered_at)}</TableCell>
      <TableCell className="py-1.5 text-right font-semibold text-foreground">
        {formatPHP(order.amount)}
      </TableCell>
      <TableCell className="py-1.5 text-right text-foreground">{formatPHPOrDash(order.marketplace_fee)}</TableCell>
      <TableCell className="py-1.5 text-right font-semibold text-foreground">
        {formatPHPOrDash(order.order_income)}
      </TableCell>
      <TableCell className="py-1.5">
        <IncomeBadge order={order} />
      </TableCell>
      {odoo && (
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
            BLANK
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

/** The orders as a table: header plus a `RetailOrderRow` each. Same flags as the row. */
export function RetailOrderTable({ orders, salesperson = false, odoo = false, arrivals }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="py-1.5">Reference</TableHead>
          <TableHead className="py-1.5">Marketplace Order ID</TableHead>
          <TableHead className="py-1.5">Buyer</TableHead>
          {salesperson && <TableHead className="py-1.5">Salesperson</TableHead>}
          <TableHead className="py-1.5">Date</TableHead>
          <TableHead className="py-1.5 text-right">Order Amount</TableHead>
          <TableHead className="py-1.5 text-right">Marketplace Fee</TableHead>
          <TableHead className="py-1.5 text-right">Order Income</TableHead>
          <TableHead className="py-1.5">Income</TableHead>
          {odoo && <TableHead className="py-1.5">Odoo</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <RetailOrderRow key={order.id} order={order} salesperson={salesperson} odoo={odoo} arrivals={arrivals} />
        ))}
      </TableBody>
    </Table>
  );
}
