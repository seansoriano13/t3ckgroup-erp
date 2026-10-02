import { useMemo } from "react";
import { ShoppingBag } from "lucide-react";
import EmptyState from "../ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPHP } from "../../constants/sor";
import { marketplaceBreakdown } from "../../utils/retailReport";

/** "13.3%" for a fee rate (a fraction), "—" when there is no rate to show. */
function formatFeeRate(rate) {
  return rate == null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

/**
 * Shopee against Lazada: one row per Marketplace, so a Marketplace's several
 * Storefronts read as one line. Takes the orders the rest of the Retail report
 * is showing (date range, and any filter, already applied) and does no
 * filtering of its own. The maths is `marketplaceBreakdown` in
 * `utils/retailReport.js`; this only lays it out.
 */
export default function MarketplaceBreakdown({ orders }) {
  const rows = useMemo(() => marketplaceBreakdown(orders), [orders]);

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">Marketplace breakdown</h3>
      <p className="mb-3 mt-0.5 text-sm text-muted-foreground">By Marketplace, for the selected range.</p>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {rows.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="No orders to break down in this range" className="py-8" />
        ) : (
          <Table aria-label="Marketplace breakdown">
            <TableHeader>
              <TableRow>
                <TableHead className="py-1.5">Marketplace</TableHead>
                <TableHead className="py-1.5 text-right">Order Income</TableHead>
                <TableHead className="py-1.5 text-right">Orders</TableHead>
                <TableHead className="py-1.5 text-right">Average order income</TableHead>
                <TableHead className="py-1.5 text-right">Marketplace Fees</TableHead>
                <TableHead className="py-1.5 text-right">Fee rate</TableHead>
                <TableHead className="py-1.5 text-right">Missing Income</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.marketplace}>
                  <TableCell className="py-1.5 font-bold text-foreground">{row.marketplace}</TableCell>
                  <TableCell className="py-1.5 text-right font-semibold tabular-nums text-foreground">
                    {formatPHP(row.orderIncome)}
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums text-foreground">
                    {row.orderCount.toLocaleString("en-PH")}
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums text-foreground">
                    {row.averageIncome == null ? "—" : formatPHP(row.averageIncome)}
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums text-foreground">
                    {formatPHP(row.totalFees)}
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums text-foreground">
                    {formatFeeRate(row.feeRate)}
                  </TableCell>
                  <TableCell
                    className={`py-1.5 text-right tabular-nums ${
                      row.missingCount === 0 ? "text-muted-foreground" : "text-foreground"
                    }`}
                  >
                    {row.missingCount.toLocaleString("en-PH")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {rows.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Order Income, average and Marketplace Fees count OK orders only. Fee rate is Marketplace Fees ÷
          (Marketplace Fees + Order Income), over OK orders that have both.
        </p>
      )}
    </div>
  );
}
