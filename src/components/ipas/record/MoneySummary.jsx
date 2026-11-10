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

/** The verdict's look: green when it matches, red when it differs, amber when the P.I is missing, quiet otherwise. */
const VERDICT = {
  [BILL_CHECK_KIND.MATCHES]: { icon: CircleCheck, className: "px-0 text-green-11" },
  [BILL_CHECK_KIND.DIFFERS]: { icon: TriangleAlert, className: "px-0 text-red-11" },
  [BILL_CHECK_KIND.NOT_TYPED]: { icon: TriangleAlert, className: "bg-amber-a3 text-amber-11" },
  [BILL_CHECK_KIND.BEFORE_TAX]: { icon: Info, className: "bg-muted text-muted-foreground" },
  [BILL_CHECK_KIND.NO_PO]: { icon: Info, className: "bg-muted text-muted-foreground" },
};

const LABEL = "text-xs text-muted-foreground";
const FIGURE = "mt-0.5 block font-mono text-lg font-semibold tracking-tight tabular-nums text-foreground break-words";

/**
 * The two amounts, right-aligned, compared character by character from the
 * right: a character that differs is marked, so a mismatch shows where it is.
 * Returns one array of `{ char, differs }` per amount, without the padding.
 */
function diffChars(left, right) {
  const width = Math.max(left.length, right.length);
  const a = left.padStart(width, " ");
  const b = right.padStart(width, " ");
  const marks = (text, other, padding) =>
    [...text].slice(padding).map((char, i) => ({ char, differs: char !== other[i + padding] }));
  return [marks(a, b, width - left.length), marks(b, a, width - right.length)];
}

/** A diff row: its sign, its label and its amount, with the differing characters marked. */
function DiffRow({ sign, label, chars, tone, testId }) {
  // Colour is in the text only (no fills): red for the Odoo PO, green for the P.I, the differing characters in bold.
  const TONE = {
    removed: { sign: "text-red-11", text: "text-red-11", mark: "font-extrabold" },
    added: { sign: "text-green-11", text: "text-green-11", mark: "font-extrabold" },
    same: { sign: "text-green-11", text: "text-foreground", mark: "" },
    plain: { sign: "text-muted-foreground", text: "text-foreground", mark: "" },
  }[tone];
  return (
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2 px-3 py-2">
      <span aria-hidden="true" className={cn("font-mono text-sm font-bold", TONE.sign)}>
        {sign}
      </span>
      <dt className="truncate text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("font-mono text-lg font-semibold tracking-tight tabular-nums whitespace-pre", TONE.text)} data-testid={testId}>
        {chars.map((c, i) =>
          c.differs && TONE.mark ? (
            <mark key={i} className={cn("bg-transparent text-inherit", TONE.mark)}>
              {c.char}
            </mark>
          ) : (
            <span key={i}>{c.char}</span>
          ),
        )}
      </dd>
    </div>
  );
}

/**
 * Supplier bill check, read like a diff: the Odoo PO in red on a "−" line, the
 * P.I/QT Amount in green on a "+" line, the characters that differ in bold, and the
 * verdict in words under them. When they match, both lines are green with "=".
 * Before there is something to compare (no P.I typed, no PO total, an older
 * before-tax copy), the lines are plain. Read from the digest, which reads the
 * IPAS figures module.
 */
function BillCheck({ bill, beforeTax }) {
  const verdict = VERDICT[bill.kind] ?? VERDICT[BILL_CHECK_KIND.NO_PO];
  const Icon = verdict.icon;
  const differs = bill.kind === BILL_CHECK_KIND.DIFFERS;
  const matches = bill.kind === BILL_CHECK_KIND.MATCHES;
  const [po, pi] = differs ? diffChars(bill.poText, bill.piText) : [[...bill.poText], [...bill.piText]].map((t) => t.map((char) => ({ char, differs: false })));
  const tone = (side) => (differs ? side : matches ? "same" : "plain");
  return (
    <section aria-labelledby="ipas-bill-check-title" data-testid="ipas-bill-check" className="min-w-0 space-y-3 p-4">
      <h3 id="ipas-bill-check-title" className="text-sm font-semibold text-foreground">
        Supplier bill check
      </h3>
      <dl className="divide-y divide-border rounded-lg border border-border">
        <DiffRow sign={matches ? "=" : "−"} label={`Odoo PO${beforeTax ? ", before tax" : ""}`} chars={po} tone={tone("removed")} testId="bill-check-po" />
        <DiffRow sign={matches ? "=" : "+"} label="P.I/QT Amount" chars={pi} tone={tone("added")} testId="bill-check-pi" />
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
 * the section it comes from. Side by side only on very wide screens (the decision rail takes the right of the page); stacked otherwise.
 */
export default function MoneySummary({ digest, onOpen }) {
  const { money, figures, bill } = digest;
  const currency = figures.currency ?? money.currency;
  const settled = figures.remainingBalance === 0;

  return (
    <div
      className="grid divide-y divide-border rounded-xl border border-border bg-card 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] 2xl:divide-x 2xl:divide-y-0"
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
