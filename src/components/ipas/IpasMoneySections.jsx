import { CircleAlert, Check, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "../ui/button";
import DetailGrid from "@/components/record/DetailGrid";
import LinerList from "@/components/record/LinerList";
import { ExternalLink } from "../ui/external-link";
import SectionHeader from "../ui/SectionHeader";
import { SelectField } from "../ui/SelectField";
import StatusBadge from "../StatusBadge";
import { IpasSection } from "./IpasSections";
import IpasPaymentsTable from "./IpasPaymentsTable";
import { useEditable } from "@/components/record/sectionChrome";
import {
  IPAS_COMPUTATION_STATUS,
  IPAS_COMPUTATION_STATUSES,
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_LANDED_COST_REASON,
  IPAS_LANDED_COST_SPLITS,
  IPAS_LANDED_COST_SPLIT_LABELS,
  IPAS_LANDED_COST_STATUS,
  IPAS_OPTION_LIST,
  IPAS_PAYMENT_KIND_LABELS,
  ipasSectionLabel,
} from "../../constants/ipas";
import { formatAmount } from "../../utils/ipas";
import { formatDay, optionsForPicker } from "../../utils/ipasPayments";
import { isLandedCostEstimate, isPhpCurrency, landedCostEstimateNote } from "../../utils/landedCost";

const SPLIT_OPTIONS = IPAS_LANDED_COST_SPLITS.map((value) => ({
  value,
  label: IPAS_LANDED_COST_SPLIT_LABELS[value],
}));

const NONE = "__none__";

const pesos = (value) => formatAmount(value, "PHP");

/** An amount inside a sentence or a label, in the same monospace figures as the tables. */
const Amt = ({ children }) => <span className="font-mono tabular-nums">{children}</span>;

/** Pieces of a row's sub line, set apart with a middle dot. */
function Dotted({ parts }) {
  const shown = parts.filter(Boolean);
  return shown.map((part, index) => (
    <span key={index}>
      {index > 0 && " · "}
      {part}
    </span>
  ));
}

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
  canChange: changeGranted = false,
  canRecord: recordGranted = false,
  onEditAmount,
  onPickFreight,
  onAddPayment,
  onEditPayment,
  onRemovePayment,
}) {
  const canChange = useEditable(changeGranted);
  const canRecord = useEditable(recordGranted);
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
      <DetailGrid
        items={[
          {
            label: "P.I/QT Amount",
            value: (
              <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                <Amt>{ipas.piQtAmount === null ? "—" : formatAmount(ipas.piQtAmount, currency)}</Amt>
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
            ),
          },
          {
            label: "Freight service",
            value: canChange ? (
              <SelectField
                size="sm"
                options={freightOptions}
                value={ipas.freight_service_id ?? NONE}
                onChange={(value) => onPickFreight(value === NONE ? null : value)}
                aria-label="Freight service"
              />
            ) : (
              ipas.freightService?.label
            ),
          },
          { label: "DP", value: sum.downPayment > 0 ? <Amt>{formatAmount(sum.downPayment, currency)}</Amt> : null },
          { label: "FP", value: sum.fullPayment > 0 ? <Amt>{formatAmount(sum.fullPayment, currency)}</Amt> : null },
        ]}
      />

      <SectionHeader title={`Payments · ${payments.length}`} className="border-b-0 pb-2">
        {canRecord && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onAddPayment}>
            <Plus size={14} />
            Add payment
          </Button>
        )}
      </SectionHeader>

      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No payments recorded yet.
          {!isPhp && landedCost.status === IPAS_LANDED_COST_STATUS.UNAVAILABLE
            ? " A foreign-currency Odoo PO needs a payment before Landed Cost can be worked out."
            : ""}
        </p>
      ) : (
        <IpasPaymentsTable ipas={ipas} canRecord={canRecord} onEditPayment={onEditPayment} onRemovePayment={onRemovePayment} />
      )}
    </div>
  );
}

/**
 * Section 3's charges: a list of kind, date and PHP amount. The documents (#246)
 * and bank details (#245) arrive as `children`, below the charges.
 */
export function IpasChargesSection({
  ipas,
  canRecord: recordGranted = false,
  onAddCharge,
  onEditCharge,
  onRemoveCharge,
  children = null,
}) {
  const canRecord = useEditable(recordGranted);
  const { charges, paymentSummary: sum } = ipas;

  return (
    <IpasSection title={ipasSectionLabel("finance")}>
      <SectionHeader title={`Charges · ${charges.length}`} className="border-b-0 pb-2">
        {canRecord && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onAddCharge}>
            <Plus size={14} />
            Add charge
          </Button>
        )}
      </SectionHeader>

      <div className="mt-3">
        <LinerList
          label="Charges"
          empty="No charges recorded yet. A charge covering several Odoo POs is recorded as this IPAS's own share."
          total={charges.length > 0 ? { label: "Total charges", value: pesos(sum.chargesPhp) } : undefined}
          rows={charges.map((charge) => ({
            key: charge.id,
            testId: "ipas-charge-row",
            main: charge.kindLabel ?? "—",
            sub: formatDay(charge.charged_on),
            quantity: pesos(charge.amount_php),
            actions: canRecord ? (
              <span className="inline-flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${charge.kindLabel ?? "charge"} of ${formatDay(charge.charged_on)}`}
                  onClick={() => onEditCharge(charge)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-red-11"
                  aria-label={`Remove ${charge.kindLabel ?? "charge"} of ${formatDay(charge.charged_on)}`}
                  onClick={() => onRemoveCharge(charge)}
                >
                  <Trash2 />
                </Button>
              </span>
            ) : undefined,
          }))}
        />
      </div>
      {children}
    </IpasSection>
  );
}

const LANDED_BADGE = {
  [IPAS_LANDED_COST_STATUS.PROVISIONAL]: { label: "Provisional" },
  [IPAS_LANDED_COST_STATUS.FINAL]: { label: "Final" },
  [IPAS_LANDED_COST_STATUS.UNAVAILABLE]: { label: "Not available" },
};

/**
 * The mark Landed Cost carries wherever it is read: estimate, provisional, final or not
 * available. `estimate` (#604) is a provisional figure with a payment's pesos still blank.
 */
export function LandedCostBadge({ status, estimate = false }) {
  const known = status in LANDED_BADGE ? status : IPAS_LANDED_COST_STATUS.UNAVAILABLE;
  // Unavailable is registered as "not available" in status.js, so it is not read as the procurement outcome of that name.
  const registered = known === IPAS_LANDED_COST_STATUS.UNAVAILABLE ? "not_available" : known;
  const label = estimate && known !== IPAS_LANDED_COST_STATUS.UNAVAILABLE ? "Estimate" : LANDED_BADGE[known].label;
  return <StatusBadge status={registered} label={label} />;
}

/**
 * Section 3's costing: the computation status (Encoding, Encoded, LC GS Done,
 * LC Odoo Done) and Landed Cost per line and per unit with its provisional or
 * final mark and how it was spread.
 *
 * The status jumps to any step, either way, by Purchasing (`canSetStatus(from, to)`
 * says; feedback on #595: the steps mean little until Purchasing says so). The current step looks selected for everyone and carries a tick like
 * the steps before it; LC Odoo Done, once reached, is green (#586). Section 3's
 * sign-offs arrive as `children`, below the Landed Cost.
 */
export function IpasCostingSection({ ipas, canChange: granted = false, canSetStatus, onSetStatus, onSetSplit, children = null }) {
  const canChange = useEditable(granted);
  const canStep = useEditable(true) && Boolean(onSetStatus);
  const lc = ipas.landedCost;
  const currentIndex = IPAS_COMPUTATION_STATUSES.indexOf(ipas.computationStatus);
  const unavailable = lc.status === IPAS_LANDED_COST_STATUS.UNAVAILABLE;
  const foreign = lc.isForeign;
  const estimate = isLandedCostEstimate(lc);
  const mayStep = (status, index) =>
    index !== currentIndex && (canSetStatus ? canSetStatus(ipas.computationStatus, status) : granted);
  const anyStep = IPAS_COMPUTATION_STATUSES.some((status, index) => mayStep(status, index));

  return (
    <IpasSection title={ipasSectionLabel("costing")}>
      <div className="space-y-4">
        <div>
          <SectionHeader title="Computation status" className="border-b-0 pb-2" />
          <ol className="mt-2 flex flex-wrap items-center gap-2" aria-label="Computation status">
            {IPAS_COMPUTATION_STATUSES.map((status, index) => {
              const done = index <= currentIndex;
              const current = index === currentIndex;
              const finished = current && status === IPAS_COMPUTATION_STATUS.LC_ODOO_DONE;
              return (
                <li key={status}>
                  {canStep && anyStep ? (
                    <Button
                      size="sm"
                      variant={current ? "secondary" : "outline"}
                      aria-pressed={current}
                      disabled={!current && !mayStep(status, index)}
                      className={`gap-1.5 ${
                        finished
                          ? "border-green-400 bg-green-2 font-semibold text-green-11"
                          : current
                            ? "border-foreground/40 font-semibold"
                            : ""
                      }`}
                      onClick={() => !current && onSetStatus(status)}
                    >
                      {done && <Check size={13} aria-hidden="true" />}
                      {IPAS_COMPUTATION_STATUS_LABELS[status]}
                    </Button>
                  ) : (
                    <span
                      className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[0.8rem] font-medium ${
                        finished
                          ? "border-green-400 bg-green-2 font-semibold text-green-11"
                          : current
                            ? "border-foreground/40 bg-secondary font-semibold text-foreground"
                            : done
                              ? "border-green-400 text-green-11"
                              : "border-border text-muted-foreground"
                      }`}
                      aria-current={current ? "step" : undefined}
                    >
                      {done && <Check size={13} aria-hidden="true" />}
                      {IPAS_COMPUTATION_STATUS_LABELS[status]}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="space-y-3">
          <SectionHeader title="Landed Cost" className="border-b-0 pb-2">
            <LandedCostBadge status={lc.status} estimate={estimate} />
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
          </SectionHeader>

          {unavailable ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm"
            >
              <CircleAlert size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="font-semibold text-foreground">Landed Cost is not available yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {lc.reason === IPAS_LANDED_COST_REASON.NO_PAYMENTS
                    ? `This Odoo PO is in ${lc.currency || "a foreign currency"}. Landed Cost converts at the rate actually paid, so it needs a payment. It is never guessed or taken from Odoo's rate.`
                    : lc.reason === IPAS_LANDED_COST_REASON.NO_REFERENCE_RATE
                      ? `A payment has no pesos taken from the bank yet, and there is no ${lc.currency || "Reference"} Reference Rate on or before its date to estimate with. Fill the pesos in to get Landed Cost.`
                      : "The Odoo PO has no item lines to cost."}
                </p>
              </div>
            </div>
          ) : (
            <>
              {estimate && (
                <p
                  role="status"
                  data-testid="landed-cost-estimate-note"
                  className="flex items-start gap-2 rounded-lg border border-amber-a4 bg-amber-a2 p-3 text-xs text-amber-11"
                >
                  <CircleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />
                  <span>{landedCostEstimateNote(lc)}</span>
                </p>
              )}
              {foreign && lc.rate && (
                <p className="text-xs text-muted-foreground">
                  {estimate ? "Estimated at" : "Converted at"}{" "}
                  <span className="font-semibold text-foreground tabular-nums">{lc.rate.rate.toFixed(4)}</span> PHP per {lc.currency}:{" "}
                  <Amt>{pesos(lc.rate.phpDebited)}</Amt> {estimate ? "(taken from the bank, plus the Reference Rate for the rest)" : "taken from the bank"} for{" "}
                  <Amt>{formatAmount(lc.rate.foreignPaid, lc.currency)}</Amt> across {lc.rate.payments}{" "}
                  {lc.rate.payments === 1 ? "payment" : "payments"}.
                </p>
              )}
              {lc.usedSplit !== lc.split && (
                <p className="text-xs text-amber-11">
                  Nothing on the lines has a price to spread by, so charges are spread equally.
                </p>
              )}
              <LinerList
                label="Landed Cost per line"
                empty="The Odoo PO has no item lines to cost."
                total={{
                  label: (
                    <>
                      Goods <Amt>{pesos(lc.totals.goodsPhp)}</Amt> + charges <Amt>{pesos(lc.totals.chargesPhp)}</Amt> + charge fees{" "}
                      <Amt>{pesos(lc.totals.chargeFeesPhp)}</Amt> + shipping fees <Amt>{pesos(lc.totals.shippingFeesPhp)}</Amt>
                    </>
                  ),
                  value: pesos(lc.totals.landedPhp),
                }}
                rows={lc.lines.map((line, index) => ({
                  key: line.lineId ?? index,
                  testId: "ipas-landed-line",
                  main: <span className="whitespace-pre-line">{line.name}</span>,
                  sub: (
                    <Dotted
                      parts={[
                        `Unit price ${pesos(line.unitPricePhp)}${foreign ? ` (${formatAmount(line.unitPriceForeign, lc.currency)})` : ""}`,
                        `Goods ${pesos(line.goodsPhp)}`,
                        `Charges & fees ${pesos(line.spreadPhp)}`,
                        `Per unit ${pesos(line.landedPerUnitPhp)}`,
                      ]}
                    />
                  ),
                  subWrap: true,
                  quantity: `${line.quantity} ${line.unit}`,
                  actions: (
                    <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-foreground">{pesos(line.landedPhp)}</span>
                  ),
                }))}
              />
            </>
          )}
        </div>
      </div>
      {children}
    </IpasSection>
  );
}
