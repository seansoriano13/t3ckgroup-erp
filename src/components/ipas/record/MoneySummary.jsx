import { ArrowUpRight, CircleCheck, Info, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/utils/ipas";
import { BILL_CHECK_KIND } from "@/utils/ipasBillCheck";
import { IPAS_AMOUNT_SOURCE } from "@/utils/ipasFigures";

const SOURCE_WORDS = {
  [IPAS_AMOUNT_SOURCE.PI_QT]: "P.I/QT Amount",
  [IPAS_AMOUNT_SOURCE.ODOO_PO]: "Odoo PO",
};

/** The verdict's look: green when it matches, amber when it needs a look, quiet otherwise. */
const VERDICT = {
  [BILL_CHECK_KIND.MATCHES]: { icon: CircleCheck, className: "bg-green-a3 text-green-11" },
  [BILL_CHECK_KIND.DIFFERS]: { icon: TriangleAlert, className: "bg-amber-a3 text-amber-11" },
  [BILL_CHECK_KIND.NOT_TYPED]: { icon: TriangleAlert, className: "bg-amber-a3 text-amber-11" },
  [BILL_CHECK_KIND.BEFORE_TAX]: { icon: Info, className: "bg-muted text-muted-foreground" },
  [BILL_CHECK_KIND.NO_PO]: { icon: Info, className: "bg-muted text-muted-foreground" },
};

const LABEL = "text-xs text-muted-foreground";
const FIGURE = "mt-0.5 block font-mono text-lg font-semibold tracking-tight tabular-nums text-foreground break-words";

/**
 * Supplier bill check: the Odoo PO total and the P.I/QT Amount side by side,
 * and what they come to in words. Read from the digest, which reads the IPAS
 * figures module.
 */
function BillCheck({ bill, beforeTax }) {
  const verdict = VERDICT[bill.kind] ?? VERDICT[BILL_CHECK_KIND.NO_PO];
  const Icon = verdict.icon;
  return (
    <section aria-labelledby="ipas-bill-check-title" data-testid="ipas-bill-check" className="min-w-0 space-y-3 p-4">
      <h3 id="ipas-bill-check-title" className="text-sm font-semibold text-foreground">
        Supplier bill check
      </h3>
      <dl className="grid grid-cols-2 gap-x-6">
        <div className="min-w-0">
          <dt className={LABEL}>Odoo PO{beforeTax ? ", before tax" : ""}</dt>
          <dd className={FIGURE} data-testid="bill-check-po">
            {bill.poText}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={LABEL}>P.I/QT Amount</dt>
          <dd className={FIGURE} data-testid="bill-check-pi">
            {bill.piText}
          </dd>
        </div>
      </dl>
      <p
        className={cn("flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs leading-relaxed font-semibold", verdict.className)}
        data-testid="bill-check-verdict"
      >
        <Icon size={14} aria-hidden="true" className="mt-px shrink-0" />
        {bill.verdict}
      </p>
    </section>
  );
}

/** One figure that opens the section it comes from. */
function Stat({ label, value, sub, onOpen }) {
  return (
    <li className="min-w-0">
      <Button
        variant="ghost"
        onClick={onOpen}
        className="group/stat h-auto w-full min-w-0 flex-col items-start justify-start gap-0 rounded-md p-0 text-left font-normal whitespace-normal hover:bg-transparent"
      >
        <span className={cn(LABEL, "flex items-center gap-1 group-hover/stat:text-foreground")}>
          {label}
          <ArrowUpRight aria-hidden="true" className="size-3 opacity-40 group-hover/stat:opacity-100" />
        </span>
        <span className={FIGURE}>{value}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </Button>
    </li>
  );
}

/**
 * The money at the top of the record (#603), as one panel: the Supplier bill
 * check on the left; Paid, Remaining balance (ADR 0036: 0 once settled) and
 * Landed Cost, which carries its Estimate mark, on the right. Each figure opens
 * the section it comes from. Stacks below the large breakpoint.
 */
export default function MoneySummary({ digest, onOpen }) {
  const { money, figures, bill } = digest;
  const currency = figures.currency ?? money.currency;
  const settled = figures.remainingBalance === 0;

  return (
    <div
      className="grid divide-y divide-border rounded-xl border border-border bg-card lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:divide-x lg:divide-y-0"
      data-testid="ipas-money-summary"
    >
      <BillCheck bill={bill} beforeTax={figures.poTotalBeforeTax} />
      <ul className="grid content-start gap-x-6 gap-y-4 p-4 sm:grid-cols-3">
        <Stat
          label="Paid"
          value={money.paymentCount > 0 ? formatAmount(figures.paid, currency) : "—"}
          sub={figures.paymentScheme || "No payments yet"}
          onOpen={() => onOpen("purchasing")}
        />
        <Stat
          label="Remaining balance"
          value={figures.remainingBalance === null ? "—" : formatAmount(figures.remainingBalance, currency)}
          sub={
            figures.amount === null
              ? "No Amount yet"
              : settled
                ? "Settled"
                : `of ${formatAmount(figures.amount, currency)} (${SOURCE_WORDS[figures.amountSource]}${figures.amountBeforeTax ? ", before tax" : ""})`
          }
          onOpen={() => onOpen("purchasing")}
        />
        <Stat label="Landed Cost" value={money.landedText} onOpen={() => onOpen("costing")} />
      </ul>
    </div>
  );
}
