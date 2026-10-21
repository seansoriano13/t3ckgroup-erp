import NumbersStrip from "@/components/record/NumbersStrip";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/utils/ipas";
import { BILL_CHECK_KIND } from "@/utils/ipasBillCheck";
import { IPAS_AMOUNT_SOURCE } from "@/utils/ipasFigures";

const SOURCE_WORDS = {
  [IPAS_AMOUNT_SOURCE.PI_QT]: "P.I/QT Amount",
  [IPAS_AMOUNT_SOURCE.ODOO_PO]: "Odoo PO",
};

/** The verdict's colour: green when it matches, amber when it needs a look, quiet otherwise. */
const VERDICT_TONE = {
  [BILL_CHECK_KIND.MATCHES]: "text-green-11",
  [BILL_CHECK_KIND.DIFFERS]: "text-amber-11",
  [BILL_CHECK_KIND.NOT_TYPED]: "text-amber-11",
  [BILL_CHECK_KIND.BEFORE_TAX]: "text-muted-foreground",
  [BILL_CHECK_KIND.NO_PO]: "text-muted-foreground",
};

/**
 * Supplier bill check: the Odoo PO total and the P.I/QT Amount side by side,
 * and what they come to in words. Read from the digest, which reads the IPAS
 * figures module.
 */
function BillCheck({ bill, beforeTax }) {
  return (
    <section
      aria-labelledby="ipas-bill-check-title"
      data-testid="ipas-bill-check"
      className="space-y-3 rounded-xl border border-border bg-card p-4"
    >
      <h3 id="ipas-bill-check-title" className="text-sm font-semibold text-foreground">
        Supplier bill check: Odoo PO vs P.I
      </h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Odoo PO{beforeTax ? ", before tax" : ""}</dt>
          <dd className="font-mono text-lg font-semibold tracking-tight tabular-nums break-words" data-testid="bill-check-po">
            {bill.poText}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">P.I/QT Amount</dt>
          <dd className="font-mono text-lg font-semibold tracking-tight tabular-nums break-words" data-testid="bill-check-pi">
            {bill.piText}
          </dd>
        </div>
      </dl>
      <p className={cn("text-sm font-semibold", VERDICT_TONE[bill.kind])} data-testid="bill-check-verdict">
        {bill.verdict}
      </p>
    </section>
  );
}

/**
 * The money at the top of the record (#603): the Supplier bill check, then
 * Paid, Remaining balance (ADR 0036: 0 once settled) and Landed Cost, which
 * carries its Estimate mark. Each stat opens the section it comes from.
 */
export default function MoneySummary({ digest, onOpen }) {
  const { money, figures, bill } = digest;
  const currency = figures.currency ?? money.currency;
  const settled = figures.remainingBalance === 0;

  return (
    <div className="space-y-4" data-testid="ipas-money-summary">
      <BillCheck bill={bill} beforeTax={figures.poTotalBeforeTax} />
      <NumbersStrip
        stats={[
          {
            key: "paid",
            label: "Paid",
            value: money.paymentCount > 0 ? formatAmount(figures.paid, currency) : "—",
            sub: figures.paymentScheme || "No payments yet",
            onOpen: () => onOpen("purchasing"),
          },
          {
            key: "remaining",
            label: "Remaining balance",
            value: figures.remainingBalance === null ? "—" : formatAmount(figures.remainingBalance, currency),
            sub:
              figures.amount === null
                ? "No Amount yet"
                : settled
                  ? "Settled"
                  : `of ${formatAmount(figures.amount, currency)} (${SOURCE_WORDS[figures.amountSource]}${figures.amountBeforeTax ? ", before tax" : ""})`,
            onOpen: () => onOpen("purchasing"),
          },
          { key: "landed", label: "Landed Cost", value: money.landedText, onOpen: () => onOpen("costing") },
        ]}
      />
    </div>
  );
}
