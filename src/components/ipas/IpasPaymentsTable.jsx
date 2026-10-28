// The Payments part of an IPAS as one bordered table (spec #699, ticket #708, layout M1):
// Payment (kind and date), Method, Amount, Forex rate, In pesos, Bank charge, Doc stamp, Misc,
// Total and Proof, with a "Paid" row that blends the rate. One table, nothing nested in its rows.

import { Paperclip, Pencil, Trash2 } from "lucide-react";

import { Button } from "../ui/button";
import { ExternalLink } from "../ui/external-link";
import StatusBadge from "../StatusBadge";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../ui/table";
import { IPAS_PAYMENT_KIND_LABELS } from "../../constants/ipas";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../utils/ipas";
import { formatDay } from "../../utils/ipasPayments";
import { blendedRate, fromCents, isPhpCurrency, paymentPhp, sumPesos, toCents } from "../../utils/landedCost";

const th = "border-b border-r border-mauve-5 bg-mauve-2 px-3 py-2 text-left text-label uppercase tracking-wider text-mauve-11 whitespace-nowrap last:border-r-0";
const td = "border-b border-r border-mauve-5 px-3 py-2.5 align-top text-[13px] leading-snug last:border-r-0";
const num = "text-right tabular-nums whitespace-nowrap";
const foot = "border-r border-mauve-5 bg-mauve-2 px-3 py-2.5 text-[13px] font-semibold last:border-r-0";

const php = (value) => (value === null || value === undefined ? "—" : formatAmount(value, "PHP"));
const fee = (value) => (value ? php(value) : "—");
const rateText = (rate) => `₱${rate.toFixed(2)}`;

export default function IpasPaymentsTable({ ipas, canRecord = false, onEditPayment, onRemovePayment }) {
  const { payments, currency } = ipas;
  const isPhp = isPhpCurrency(currency);
  const rows = payments.map((payment) => {
    const pesos = paymentPhp(payment, isPhp);
    const total = pesos === null ? null : sumPesos([pesos, payment.charge_fee_php ?? 0]);
    return { payment, pesos, total };
  });
  const paid = fromCents(rows.reduce((sum, { payment }) => sum + toCents(payment.amount ?? 0), 0));
  const pesosPaid = sumPesos(rows.map((row) => row.pesos ?? 0));
  const known = rows.filter((row) => row.pesos !== null);
  const sumFee = (key) => sumPesos(payments.map((payment) => payment[key] ?? 0));
  const average = isPhp ? null : blendedRate(payments);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-mauve-5 bg-card" data-testid="ipas-payments-table">
        <Table className="border-separate border-spacing-0">
          <TableHeader className="bg-transparent">
            <TableRow>
              <th className={th}>Payment</th>
              <th className={th}>Method</th>
              <th className={cn(th, "text-right")}>Amount</th>
              <th className={cn(th, "text-right")}>Forex rate</th>
              <th className={cn(th, "text-right")}>In pesos</th>
              <th className={cn(th, "text-right")}>Bank charge</th>
              <th className={cn(th, "text-right")}>Doc stamp</th>
              <th className={cn(th, "text-right")}>Misc</th>
              <th className={cn(th, "text-right")}>Total</th>
              <th className={th}>Proof</th>
              {canRecord && <th className={th}><span className="sr-only">Actions</span></th>}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y-0">
            {rows.map(({ payment, pesos, total }) => {
              const kind = IPAS_PAYMENT_KIND_LABELS[payment.kind] ?? payment.kind;
              return (
                <TableRow key={payment.id} data-testid="ipas-payment-row" className="hover:bg-transparent">
                  <TableCell className={td}>
                    <div className="font-semibold">{kind}</div>
                    <div className="text-xs text-mauve-11">{formatDay(payment.paid_on)}</div>
                    {payment.check_no && <div className="text-xs text-mauve-11">Check No. {payment.check_no}</div>}
                    {payment.paid_before_approval && <StatusBadge theme="amber" label="Paid before approval" />}
                  </TableCell>
                  <TableCell className={td}>{payment.methodLabel ?? "—"}</TableCell>
                  <TableCell className={cn(td, num)}>{formatAmount(payment.amount, currency)}</TableCell>
                  <TableCell className={cn(td, num)}>{isPhp || !payment.rate ? "—" : rateText(payment.rate)}</TableCell>
                  <TableCell className={cn(td, num)}>
                    {pesos === null ? <span className="text-amber-11">Not in yet</span> : php(pesos)}
                  </TableCell>
                  <TableCell className={cn(td, num)}>{fee(payment.bank_charge_php)}</TableCell>
                  <TableCell className={cn(td, num)}>{fee(payment.doc_stamp_php)}</TableCell>
                  <TableCell className={cn(td, num)}>{fee(payment.misc_fee_php)}</TableCell>
                  <TableCell className={cn(td, num, "font-semibold")}>{php(total)}</TableCell>
                  <TableCell className={td}>
                    {payment.proof_url ? (
                      <ExternalLink
                        href={payment.proof_url}
                        className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-2"
                      >
                        <Paperclip size={12} aria-hidden="true" />
                        View
                      </ExternalLink>
                    ) : (
                      <StatusBadge theme="amber" label="Missing" />
                    )}
                  </TableCell>
                  {canRecord && (
                    <TableCell className={td}>
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${kind ?? "payment"} of ${formatDay(payment.paid_on)}`}
                          onClick={() => onEditPayment(payment)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-red-11"
                          aria-label={`Remove ${kind ?? "payment"} of ${formatDay(payment.paid_on)}`}
                          onClick={() => onRemovePayment(payment)}
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
              <td className={foot}>Paid</td>
              <td className={foot} />
              <td className={cn(foot, num)}>{formatAmount(paid, currency)}</td>
              <td className={cn(foot, num, "font-normal text-mauve-11")}>{average ? `avg ${rateText(average)}` : ""}</td>
              <td className={cn(foot, num)}>{known.length > 0 ? php(pesosPaid) : "—"}</td>
              <td className={cn(foot, num)}>{fee(sumFee("bank_charge_php"))}</td>
              <td className={cn(foot, num)}>{fee(sumFee("doc_stamp_php"))}</td>
              <td className={cn(foot, num)}>{fee(sumFee("misc_fee_php"))}</td>
              <td className={cn(foot, num)}>{known.length > 0 ? php(sumPesos(known.map((row) => row.total ?? 0))) : "—"}</td>
              <td className={foot} />
              {canRecord && <td className={foot} />}
            </tr>
          </tfoot>
        </Table>
      </div>
      {!isPhp && (
        <p className="text-xs text-muted-foreground">A payment from a dollar account takes the rate those dollars were bought at.</p>
      )}
    </div>
  );
}
