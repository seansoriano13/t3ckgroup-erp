/**
 * IPAS figures (spec #595, ticket #596): the one place that works out an
 * IPAS's money from the shaped IPAS. The list row, its totals, the export, the
 * record's money summary and the section 1 approval warning all read this and
 * never compute these figures themselves.
 *
 * Pure: no network, no React. The IPAS Status joins this module in #597 (it
 * reads the same payments); the money figures are built first so `status` can be
 * added to the result, and the Remaining balance's "settled" rule can then read
 * it instead of the two facts it stands in for today.
 *
 * Input is a shaped IPAS (utils/ipas.js `shapeIpas`, with `payments` from the
 * list read or the record read):
 *   odoo_copy      the stored Odoo copy: `po.amount_untaxed / amount_tax /
 *                  amount_total` (copies stored before #596 have none), `lines`
 *   pi_qt_amount   the typed P.I/QT Amount, or null
 *   payments       [{ kind, amount, methodLabel | method.label, paid_on? }]
 *   state          open / filed / cancelled
 * Everything is in the PO's currency; currencies are never converted.
 */

import { IPAS_PAYMENT_KIND, IPAS_STATE } from "../constants/ipas";
import { finiteNumber } from "./landedCost";

/** The bill check's three answers. */
export const IPAS_BILL_CHECK = Object.freeze({
  MISSING: "missing",
  MATCHES: "matches",
  DIFFERS: "differs",
});

/** Where Amount came from: the typed P.I/QT Amount, or the Odoo PO. */
export const IPAS_AMOUNT_SOURCE = Object.freeze({
  PI_QT: "pi_qt",
  ODOO_PO: "odoo_po",
});

/** Joins the payment methods in a Payment scheme ("Bank TT + Cash"). */
export const PAYMENT_SCHEME_SEPARATOR = " + ";

const toCents = (n) => Math.round(n * 100);
const fromCents = (c) => c / 100;

/**
 * The Odoo PO's total as the copy states it, or, for an older copy without
 * totals, the sum of its line subtotals. `beforeTax` is true for the fallback:
 * line subtotals leave tax out, so a bill check against it must say so instead
 * of calling the gap a mismatch. `null` when the copy has neither.
 */
export function odooPoTotal(copy) {
  const stated = finiteNumber(copy?.po?.amount_total);
  if (stated !== null) return { total: stated, beforeTax: false };

  const lines = Array.isArray(copy?.lines) ? copy.lines : [];
  const subtotals = lines.map((line) => finiteNumber(line?.price_subtotal)).filter((n) => n !== null);
  if (subtotals.length === 0) return null;
  return { total: fromCents(subtotals.reduce((sum, n) => sum + toCents(n), 0)), beforeTax: true };
}

/** The payments in the order they were made (paid_on, then recorded), stable for ties. */
function inPaymentOrder(payments) {
  return payments
    .map((payment, index) => ({ payment, index }))
    .sort((a, b) => {
      const byDay = String(a.payment?.paid_on ?? "").localeCompare(String(b.payment?.paid_on ?? ""));
      if (byDay) return byDay;
      const byTime = String(a.payment?.created_at ?? "").localeCompare(String(b.payment?.created_at ?? ""));
      return byTime || a.index - b.index;
    })
    .map(({ payment }) => payment);
}

const methodLabelOf = (payment) => {
  const label = payment?.methodLabel ?? payment?.method?.label ?? null;
  const trimmed = typeof label === "string" ? label.trim() : "";
  return trimmed || null;
};

/**
 * Everything money-related about one IPAS:
 *
 *   currency            the PO's currency, or null
 *   piAmount            the typed P.I/QT Amount, or null
 *   poTotal             the Odoo PO total (tax included), or the line subtotals
 *                       for an older copy, or null
 *   poTotalBeforeTax    true when poTotal is that older-copy fallback
 *   amount              piAmount when typed, else poTotal, else null
 *   amountSource        "pi_qt" | "odoo_po" | null
 *   amountBeforeTax     true when amount is the before-tax fallback
 *   billCheck           { status: "missing" | "matches" | "differs", difference,
 *                         poBeforeTax }. `difference` is P.I minus Odoo PO, signed,
 *                         to the cent; null when missing. Compared exactly, in the
 *                         PO's currency.
 *   downPayment         sum of the Down payment rows
 *   fullPayment         sum of the Full payment rows
 *   hasFullPayment      a Full payment row is recorded
 *   paid                every payment row, whatever its kind
 *   remainingBalance    amount - paid; 0 once a full payment is recorded or the
 *                       IPAS is filed (ADR 0035: withholding never leaves a settled
 *                       order owing); null when there is no Amount
 *   paymentMethods      distinct method labels, first used first
 *   paymentScheme       those joined, "Bank TT + Cash"; "" with none
 */
export function ipasFigures(ipas) {
  const copy = ipas?.odoo_copy ?? null;
  const payments = inPaymentOrder(Array.isArray(ipas?.payments) ? ipas.payments : []);

  const currency = ipas?.currency ?? copy?.po?.currency ?? null;
  const piAmount = finiteNumber(ipas?.pi_qt_amount ?? ipas?.piQtAmount);
  const po = odooPoTotal(copy);
  const poTotal = po?.total ?? null;
  const poTotalBeforeTax = po?.beforeTax ?? false;

  let amount = null;
  let amountSource = null;
  let amountBeforeTax = false;
  if (piAmount !== null) {
    amount = piAmount;
    amountSource = IPAS_AMOUNT_SOURCE.PI_QT;
  } else if (poTotal !== null) {
    amount = poTotal;
    amountSource = IPAS_AMOUNT_SOURCE.ODOO_PO;
    amountBeforeTax = poTotalBeforeTax;
  }

  const billCheck = { status: IPAS_BILL_CHECK.MISSING, difference: null, poBeforeTax: poTotalBeforeTax };
  if (piAmount !== null && poTotal !== null) {
    const difference = fromCents(toCents(piAmount) - toCents(poTotal));
    billCheck.difference = difference;
    billCheck.status = difference === 0 ? IPAS_BILL_CHECK.MATCHES : IPAS_BILL_CHECK.DIFFERS;
  }

  let downCents = 0;
  let fullCents = 0;
  let paidCents = 0;
  let hasFullPayment = false;
  const methods = [];
  for (const payment of payments) {
    const cents = toCents(finiteNumber(payment?.amount) ?? 0);
    paidCents += cents;
    if (payment?.kind === IPAS_PAYMENT_KIND.DOWN_PAYMENT) downCents += cents;
    if (payment?.kind === IPAS_PAYMENT_KIND.FULL_PAYMENT) {
      fullCents += cents;
      hasFullPayment = true;
    }
    const label = methodLabelOf(payment);
    if (label && !methods.includes(label)) methods.push(label);
  }

  // ADR 0035: a full payment settles the balance, and so does filing. #597 turns
  // this into "status is Paid or Done"; until then it is the same two facts.
  const settled = hasFullPayment || ipas?.state === IPAS_STATE.FILED;
  let remainingBalance = null;
  if (settled) remainingBalance = 0;
  else if (amount !== null) remainingBalance = fromCents(toCents(amount) - paidCents);

  return {
    currency,
    piAmount,
    poTotal,
    poTotalBeforeTax,
    amount,
    amountSource,
    amountBeforeTax,
    billCheck,
    downPayment: fromCents(downCents),
    fullPayment: fromCents(fullCents),
    hasFullPayment,
    paid: fromCents(paidCents),
    remainingBalance,
    paymentMethods: methods,
    paymentScheme: methods.join(PAYMENT_SCHEME_SEPARATOR),
  };
}
