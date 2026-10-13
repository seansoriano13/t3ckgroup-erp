import { CircleAlert, Check, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "../ui/button";
import { DetailRow } from "../ui/DetailParts";
import { ExternalLink } from "../ui/external-link";
import { SelectField } from "../ui/SelectField";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import StatusBadge from "../StatusBadge";
import { IpasSection } from "./IpasSections";
import {
  IPAS_COMPUTATION_STATUSES,
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_LANDED_COST_REASON,
  IPAS_LANDED_COST_SPLITS,
  IPAS_LANDED_COST_SPLIT_LABELS,
  IPAS_LANDED_COST_STATUS,
  IPAS_OPTION_LIST,
  IPAS_PAYMENT_KIND_LABELS,
} from "../../constants/ipas";
import { formatAmount } from "../../utils/ipas";
import { formatDay, optionsForPicker } from "../../utils/ipasPayments";
import { isPhpCurrency } from "../../utils/landedCost";

const HEAD = "text-[10px] font-bold uppercase tracking-wider";

const SPLIT_OPTIONS = IPAS_LANDED_COST_SPLITS.map((value) => ({
  value,
  label: IPAS_LANDED_COST_SPLIT_LABELS[value],
}));

const NONE = "__none__";

const pesos = (value) => formatAmount(value, "PHP");

/**
 * Section 1's money: the header amounts (P.I/QT Amount typed; DP and FP read
 * off the payment rows; no balance anywhere), the one freight service, and the
 * payments list.
 *
 *   canChange   Purchasing on an open IPAS: types the amount, picks the freight
 *               service
 *   canRecord   Purchasing or Finance on an open IPAS: payments add, edit, remove
 */
export function IpasPaymentsBlock({
  ipas,
  canChange = false,
  canRecord = false,
  onEditAmount,
  onPickFreight,
  onAddPayment,
  onEditPayment,
  onRemovePayment,
}) {
  const { payments, paymentSummary: sum, currency, landedCost } = ipas;
  const isPhp = isPhpCurrency(currency);
  const freightOptions = [
    { value: NONE, label: "None" },
    ...optionsForPicker(ipas.options ?? [], IPAS_OPTION_LIST.FREIGHT_SERVICE, ipas.freight_service_id).map((o) => ({
      value: o.id,
      label: o.active ? o.label : `${o.label} (deactivated)`,
    })),
  ];

  return (
    <div className="mt-4 space-y-3">
      <dl className="grid grid-cols-1 gap-x-8 divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
        <DetailRow label="P.I/QT Amount">
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{ipas.piQtAmount === null ? "—" : formatAmount(ipas.piQtAmount, currency)}</span>
            {canChange && (
              <Button
                variant="ghost"
                size="xs"
                className="gap-1 text-muted-foreground"
                aria-label="Edit P.I/QT Amount"
                onClick={onEditAmount}
              >
                <Pencil size={12} />
                Edit
              </Button>
            )}
          </span>
        </DetailRow>
        <DetailRow label="Freight service">
          {canChange ? (
            <SelectField
              size="sm"
              options={freightOptions}
              value={ipas.freight_service_id ?? NONE}
              onChange={(value) => onPickFreight(value === NONE ? null : value)}
              aria-label="Freight service"
            />
          ) : (
            ipas.freightService?.label
          )}
        </DetailRow>
        <DetailRow label="DP">{sum.downPayment > 0 ? formatAmount(sum.downPayment, currency) : null}</DetailRow>
        <DetailRow label="FP">{sum.fullPayment > 0 ? formatAmount(sum.fullPayment, currency) : null}</DetailRow>
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Payments</h3>
        {canRecord && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onAddPayment}>
            <Plus size={14} />
            Add payment
          </Button>
        )}
      </div>

      {payments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
          No payments recorded yet.
          {!isPhp && landedCost.status === IPAS_LANDED_COST_STATUS.UNAVAILABLE
            ? " A foreign-currency PO needs a payment with the PHP debited before Landed Cost can be worked out."
            : ""}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table className="md:min-w-[48rem]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className={HEAD}>Payment</TableHead>
                <TableHead className={HEAD}>Date</TableHead>
                <TableHead className={`${HEAD} text-right`}>{isPhp ? "Amount" : `Amount (${currency})`}</TableHead>
                {!isPhp && <TableHead className={`${HEAD} text-right`}>PHP debited</TableHead>}
                <TableHead className={`${HEAD} text-right`}>Charge fee</TableHead>
                <TableHead className={HEAD}>Method</TableHead>
                <TableHead className={HEAD}>Proof</TableHead>
                {canRecord && <TableHead className={`${HEAD} text-right`}>
                  <span className="sr-only">Actions</span>
                </TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id} data-testid="ipas-payment-row">
                  <TableCell className="text-[13px] font-medium text-foreground">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {IPAS_PAYMENT_KIND_LABELS[payment.kind] ?? payment.kind}
                      {payment.paid_before_approval && <StatusBadge theme="amber" label="Paid before approval" />}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">{formatDay(payment.paid_on)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums">
                    {formatAmount(payment.amount, currency)}
                  </TableCell>
                  {!isPhp && (
                    <TableCell className="text-right text-xs tabular-nums">
                      {payment.php_debited === null ? (
                        <span className="text-amber-11">Missing</span>
                      ) : (
                        pesos(payment.php_debited)
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {payment.charge_fee_php ? pesos(payment.charge_fee_php) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-foreground">
                    {payment.methodLabel ?? "—"}
                    {payment.check_no && (
                      <span className="block text-[11px] text-muted-foreground">Check No. {payment.check_no}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {payment.proof_url ? (
                      <ExternalLink
                        href={payment.proof_url}
                        className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
                      >
                        <Paperclip size={12} aria-hidden="true" />
                        View
                      </ExternalLink>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {canRecord && (
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Edit ${IPAS_PAYMENT_KIND_LABELS[payment.kind] ?? "payment"} of ${formatDay(payment.paid_on)}`}
                          onClick={() => onEditPayment(payment)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-red-11"
                          aria-label={`Remove ${IPAS_PAYMENT_KIND_LABELS[payment.kind] ?? "payment"} of ${formatDay(payment.paid_on)}`}
                          onClick={() => onRemovePayment(payment)}
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-border bg-muted/20 px-4 py-2 text-xs">
            <span className="text-muted-foreground">
              Total debited, including charge fees
              {sum.missingPhp > 0 && ` · ${sum.missingPhp} payment${sum.missingPhp === 1 ? "" : "s"} without PHP debited`}
            </span>
            <span className="font-semibold tabular-nums">{pesos(sum.totalDebitedPhp)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Section 3's charges: a list of kind, date and PHP amount. Documents and bank
 * details join this section in their own tickets.
 */
export function IpasChargesSection({ ipas, canRecord = false, onAddCharge, onEditCharge, onRemoveCharge }) {
  const { charges, paymentSummary: sum } = ipas;

  return (
    <IpasSection
      title="3 · Purchasing & Finance"
      aside={charges.length > 0 ? <span>Charges: {pesos(sum.chargesPhp)}</span> : null}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Importation charges</h3>
        {canRecord && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onAddCharge}>
            <Plus size={14} />
            Add charge
          </Button>
        )}
      </div>

      {charges.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
          No charges recorded yet. A charge covering several POs is recorded as this IPAS&apos;s own share.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <Table className="md:min-w-[28rem]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className={HEAD}>Charge</TableHead>
                <TableHead className={HEAD}>Date</TableHead>
                <TableHead className={`${HEAD} text-right`}>Amount (PHP)</TableHead>
                {canRecord && <TableHead className={`${HEAD} text-right`}>
                  <span className="sr-only">Actions</span>
                </TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {charges.map((charge) => (
                <TableRow key={charge.id} data-testid="ipas-charge-row">
                  <TableCell className="text-[13px] font-medium text-foreground">{charge.kindLabel ?? "—"}</TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">{formatDay(charge.charged_on)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums">{pesos(charge.amount_php)}</TableCell>
                  {canRecord && (
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Edit ${charge.kindLabel ?? "charge"} of ${formatDay(charge.charged_on)}`}
                          onClick={() => onEditCharge(charge)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-red-11"
                          aria-label={`Remove ${charge.kindLabel ?? "charge"} of ${formatDay(charge.charged_on)}`}
                          onClick={() => onRemoveCharge(charge)}
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-between gap-3 border-t border-border bg-muted/20 px-4 py-2 text-xs">
            <span className="text-muted-foreground">Total charges</span>
            <span className="font-semibold tabular-nums">{pesos(sum.chargesPhp)}</span>
          </div>
        </div>
      )}
    </IpasSection>
  );
}

const LANDED_BADGE = {
  [IPAS_LANDED_COST_STATUS.PROVISIONAL]: { theme: "amber", label: "Provisional" },
  [IPAS_LANDED_COST_STATUS.FINAL]: { theme: "green", label: "Final" },
  [IPAS_LANDED_COST_STATUS.UNAVAILABLE]: { theme: "mauve", label: "Not available" },
};

/** The mark Landed Cost carries wherever it is read: provisional, final or not available. */
export function LandedCostBadge({ status }) {
  const badge = LANDED_BADGE[status] ?? LANDED_BADGE[IPAS_LANDED_COST_STATUS.UNAVAILABLE];
  return <StatusBadge theme={badge.theme} label={badge.label} />;
}

/**
 * Section 6's costing: the computation status (Encoding, Encoded, Costs
 * complete, Checked by; set by Purchasing) and Landed Cost per line and per
 * unit with its provisional or final mark and how it was spread.
 */
export function IpasCostingSection({ ipas, canChange = false, onSetStatus, onSetSplit }) {
  const lc = ipas.landedCost;
  const currentIndex = IPAS_COMPUTATION_STATUSES.indexOf(ipas.computationStatus);
  const unavailable = lc.status === IPAS_LANDED_COST_STATUS.UNAVAILABLE;
  const foreign = lc.isForeign;

  return (
    <IpasSection
      title="6 · Computation status & Landed Cost"
      aside={<LandedCostBadge status={lc.status} />}
    >
      <div className="space-y-4">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Computation status</h3>
          <ol className="mt-2 flex flex-wrap items-center gap-2" aria-label="Computation status">
            {IPAS_COMPUTATION_STATUSES.map((status, index) => {
              const done = index <= currentIndex;
              const current = index === currentIndex;
              return (
                <li key={status}>
                  {canChange ? (
                    <Button
                      size="sm"
                      variant={current ? "default" : "outline"}
                      aria-pressed={current}
                      className="gap-1.5"
                      onClick={() => !current && onSetStatus(status)}
                    >
                      {done && !current && <Check size={13} aria-hidden="true" />}
                      {IPAS_COMPUTATION_STATUS_LABELS[status]}
                    </Button>
                  ) : (
                    <span
                      className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[0.8rem] font-medium ${
                        current
                          ? "border-foreground bg-foreground text-background"
                          : done
                            ? "border-green-400 text-green-11"
                            : "border-border text-muted-foreground"
                      }`}
                      aria-current={current ? "step" : undefined}
                    >
                      {done && !current && <Check size={13} aria-hidden="true" />}
                      {IPAS_COMPUTATION_STATUS_LABELS[status]}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Landed Cost reads provisional until Costs complete, then final.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Landed Cost</h3>
              <LandedCostBadge status={lc.status} />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Spread charges</span>
              {canChange ? (
                <SelectField
                  size="sm"
                  options={SPLIT_OPTIONS}
                  value={ipas.landedCostSplit}
                  onChange={onSetSplit}
                  className="w-auto"
                  aria-label="Spread charges"
                />
              ) : (
                <span className="font-medium text-foreground">
                  {IPAS_LANDED_COST_SPLIT_LABELS[ipas.landedCostSplit]}
                </span>
              )}
            </div>
          </div>

          {unavailable ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-[13px]"
            >
              <CircleAlert size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="font-semibold text-foreground">Landed Cost is not available yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {lc.reason === IPAS_LANDED_COST_REASON.NO_PAYMENTS
                    ? `This PO is in ${lc.currency || "a foreign currency"}. Landed Cost converts at the rate actually paid, so it needs a payment with the PHP debited. It is never guessed or taken from Odoo's rate.`
                    : "The PO has no item lines to cost."}
                </p>
              </div>
            </div>
          ) : (
            <>
              {foreign && lc.rate && (
                <p className="text-xs text-muted-foreground">
                  Converted at <span className="font-semibold text-foreground tabular-nums">{lc.rate.rate.toFixed(4)}</span>{" "}
                  PHP per {lc.currency}: {pesos(lc.rate.phpDebited)} debited for{" "}
                  {formatAmount(lc.rate.foreignPaid, lc.currency)} across {lc.rate.payments}{" "}
                  {lc.rate.payments === 1 ? "payment" : "payments"}.
                </p>
              )}
              {lc.usedSplit !== lc.split && (
                <p className="text-xs text-amber-11">
                  Nothing on the lines has a price to spread by, so charges are spread equally.
                </p>
              )}
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table className="md:min-w-[44rem]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className={HEAD}>Item</TableHead>
                      <TableHead className={`${HEAD} text-right`}>Qty</TableHead>
                      <TableHead className={`${HEAD} text-right`}>Unit price (PHP)</TableHead>
                      <TableHead className={`${HEAD} text-right`}>Goods</TableHead>
                      <TableHead className={`${HEAD} text-right`}>Charges &amp; fees</TableHead>
                      <TableHead className={`${HEAD} text-right`}>Landed Cost</TableHead>
                      <TableHead className={`${HEAD} text-right`}>Per unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lc.lines.map((line, index) => (
                      <TableRow key={line.lineId ?? index} data-testid="ipas-landed-line">
                        <TableCell className="max-w-[18rem] whitespace-pre-line text-[13px] text-foreground">
                          {line.name}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {line.quantity} {line.unit}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {pesos(line.unitPricePhp)}
                          {foreign && (
                            <span className="block text-[11px] text-muted-foreground">
                              {formatAmount(line.unitPriceForeign, lc.currency)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{pesos(line.goodsPhp)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {pesos(line.spreadPhp)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold tabular-nums">
                          {pesos(line.landedPhp)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold tabular-nums">
                          {pesos(line.landedPerUnitPhp)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-border bg-muted/20 px-4 py-2 text-xs">
                  <span className="text-muted-foreground">
                    Goods {pesos(lc.totals.goodsPhp)} + charges {pesos(lc.totals.chargesPhp)} + charge fees{" "}
                    {pesos(lc.totals.chargeFeesPhp)} + shipping fees {pesos(lc.totals.shippingFeesPhp)}
                  </span>
                  <span className="font-semibold tabular-nums">{pesos(lc.totals.landedPhp)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </IpasSection>
  );
}
