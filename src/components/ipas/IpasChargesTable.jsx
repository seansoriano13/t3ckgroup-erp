// Section 3's Freight and charges as one bordered table (spec #699, ticket #709, layout M1), in the
// same chrome as the Payments table: Charge, Date, Amount and File, freight first, and a totals row
// "Spread over the lines". A blank charge is tinted amber and reads "Fill or remove".
// One table, nothing nested in its rows.

import { CircleAlert, Paperclip, Pencil, Trash2 } from "lucide-react";

import { Button } from "../ui/button";
import { ExternalLink } from "../ui/external-link";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../ui/table";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../utils/ipas";
import { formatDay } from "../../utils/ipasPayments";
import { finiteNumber, isPhpCurrency, sumPesos } from "../../utils/landedCost";

const th = "border-b border-r border-mauve-5 bg-mauve-2 px-3 py-2 text-left text-label uppercase tracking-wider text-mauve-11 whitespace-nowrap last:border-r-0";
const td = "border-b border-r border-mauve-5 px-3 py-2.5 align-top text-[13px] leading-snug last:border-r-0";
const num = "text-right tabular-nums whitespace-nowrap";
const foot = "border-r border-mauve-5 bg-mauve-2 px-3 py-2.5 text-[13px] font-semibold last:border-r-0";
const blankRow = "hover:bg-transparent [&>td]:bg-amber-2";

const php = (value) => (value === null || value === undefined ? "—" : formatAmount(value, "PHP"));

function FileCell({ url, needed }) {
  if (url) {
    return (
      <ExternalLink href={url} className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-2">
        <Paperclip size={12} aria-hidden="true" />
        View
      </ExternalLink>
    );
  }
  return <span className={cn("text-xs", needed ? "font-semibold text-amber-12" : "text-mauve-11")}>{needed ? "File needed" : "No file"}</span>;
}

/** How freight reads in its Amount cell: "$470.00 × ₱59.32", plus a note when the supplier billed it. */
function freightFigures(ipas) {
  const amount = finiteNumber(ipas.freight_amount);
  if (amount === null) return null;
  const currency = ipas.freight_currency || "PHP";
  const billed = Boolean(ipas.freight_billed_by_supplier);
  const rate = ipas.landedCost?.rate?.rate;
  const converts = !isPhpCurrency(currency) && currency.toUpperCase() === String(ipas.currency ?? "").toUpperCase() && rate;
  return { amount, currency, billed, rate: converts ? rate : null };
}

export default function IpasChargesTable({ ipas, canRecord = false, onEditCharge, onRemoveCharge }) {
  const charges = ipas.charges ?? [];
  const freight = freightFigures(ipas);
  const blanks = charges.filter((charge) => finiteNumber(charge.amount_php) === null).length;
  const chargesTotal = sumPesos(charges.map((charge) => finiteNumber(charge.amount_php) ?? 0));
  const freightPhp = ipas.landedCost?.totals?.freightPhp ?? 0;
  const bankCharges = ipas.paymentSummary?.chargeFeesPhp ?? 0;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-mauve-5 bg-card" data-testid="ipas-charges-table">
        <Table className="border-separate border-spacing-0">
          <TableHeader className="bg-transparent">
            <TableRow>
              <th className={th}>Charge</th>
              <th className={th}>Date</th>
              <th className={cn(th, "text-right")}>Amount</th>
              <th className={th}>File</th>
              {canRecord && <th className={th}><span className="sr-only">Actions</span></th>}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y-0">
            <TableRow data-testid="ipas-freight-row" className={freight ? "hover:bg-transparent" : blankRow}>
              <TableCell className={td}>
                <div className="font-semibold">Freight{ipas.freightService?.label ? ` · ${ipas.freightService.label}` : ""}</div>
                {freight?.billed && <div className="text-xs text-mauve-11">billed by the supplier, inside the payments</div>}
              </TableCell>
              <TableCell className={td}>—</TableCell>
              <TableCell className={cn(td, num)}>
                {freight ? (
                  <>
                    {formatAmount(freight.amount, freight.currency)}
                    {freight.rate ? ` × ₱${freight.rate.toFixed(2)}` : ""}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-12">
                    <CircleAlert size={12} aria-hidden="true" /> Not typed
                  </span>
                )}
              </TableCell>
              <TableCell className={td}>
                <FileCell url={ipas.freight_attachment_url} needed={false} />
              </TableCell>
              {canRecord && <TableCell className={td} />}
            </TableRow>
            {charges.map((charge) => {
              const amount = finiteNumber(charge.amount_php);
              const empty = amount === null;
              const label = charge.kindLabel ?? "charge";
              return (
                <TableRow key={charge.id} data-testid="ipas-charge-row" className={empty ? blankRow : "hover:bg-transparent"}>
                  <TableCell className={cn(td, "font-semibold")}>{charge.kindLabel ?? "—"}</TableCell>
                  <TableCell className={td}>{charge.charged_on ? formatDay(charge.charged_on) : "—"}</TableCell>
                  <TableCell className={cn(td, num)}>
                    {empty ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-12">
                        <CircleAlert size={12} aria-hidden="true" /> Fill or remove
                      </span>
                    ) : (
                      php(amount)
                    )}
                  </TableCell>
                  <TableCell className={td}>
                    <FileCell url={charge.attachment_url} needed={!empty} />
                  </TableCell>
                  {canRecord && (
                    <TableCell className={td}>
                      <span className="inline-flex items-center gap-1">
                        <Button variant="ghost" size="icon" aria-label={`Edit ${label}`} onClick={() => onEditCharge?.(charge)}>
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-red-11"
                          aria-label={`Remove ${label}`}
                          onClick={() => onRemoveCharge?.(charge)}
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
          <tfoot>
            <tr>
              <td className={foot}>Spread over the lines</td>
              <td className={foot} />
              <td className={cn(foot, num)}>{php(sumPesos([chargesTotal, freightPhp]))}</td>
              <td className={cn(foot, "font-normal text-mauve-11")}>+ bank charges {php(bankCharges)}</td>
              {canRecord && <td className={foot} />}
            </tr>
          </tfoot>
        </Table>
      </div>
      {blanks > 0 && (
        <p role="status" data-testid="ipas-charges-blank-note" className="flex items-start gap-2 text-xs text-amber-11">
          <CircleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />
          <span>
            {blanks} {blanks === 1 ? "charge is" : "charges are"} blank. Sections 2 and 3 wait until each is filled in or removed.
          </span>
        </p>
      )}
    </div>
  );
}
