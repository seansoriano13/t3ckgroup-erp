/**
 * IPAS figures (spec #595, ticket #596): the one place that works out an
 * IPAS's money from the shaped IPAS. The list row, its totals, the export, the
 * record's money summary and the section 1 approval warning all read this and
 * never compute these figures themselves.
 *
 * Pure: no network, no React. The IPAS Status is stored and set by hand (ADR 0054,
 * spec #1151) and passes through here as `status`. The Remaining balance settles on
 * a full payment or on filing, read from those facts (ADR 0036, amended).
 *
 * Input is a shaped IPAS (utils/ipas.js `shapeIpas`, with `payments` from the
 * list read or the record read):
 *   odoo_copy      the stored Odoo copy: `po.amount_untaxed / amount_tax /
 *                  amount_total` (copies stored before #596 have none), `lines`
 *   pi_qt_amount   the typed P.I/QT Amount, or null
 *   payments       [{ kind, amount, methodLabel | method.label, paid_on? }]
 *   state          open / filed / cancelled
 *   on_hold        the On-Hold flag (`ipas.on_hold`), and on_hold_note its note
 *   status         the stored IPAS Status key (`ipas.status`)
 * Everything is in the PO's currency; currencies are never converted.
 */

import { IPAS_PAYMENT_KIND, IPAS_PAYMENT_STATUS, IPAS_STATE } from "../constants/ipas";
import { finiteNumber, fromCents, toCents } from "./landedCost";
import { paymentKindWithPercent } from "./ipasPaymentPercent";

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
 *   status              the stored IPAS Status key (constants/ipas IPAS_STATUS), or null for a
 *                       cancelled IPAS
 *   onHold, onHoldNote  the On-Hold flag and its note (the note only while on hold)
 *   paymentStatus       the Payment status (ADR 0055): for_payment while `payment_ask` (the open ask) is set,
 *                       else paid at a balance of 0 or less, else dp_paid with anything paid, else not_due_yet;
 *                       null for a cancelled IPAS
 *   paymentAsk          the open ask {amount, purpose, note, ...} or null
 *   remainingBalance    amount - paid; 0 once a full payment is recorded or the IPAS is filed (ADR 0036:
 *                       withholding never leaves a settled order owing); null when
 *                       there is no Amount
 *   overpaidBy          paid - amount when the payments pass the order amount (spec #1123, A2); 0 otherwise
 *   paymentMethods      distinct method labels, first used first
 *   paymentScheme       those joined, "Bank TT + Cash"; "" with none
 *   paymentPercents     the payments that are a percent of the order, "Down payment · 30%; Payment · 45%"; "" with none
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
  const percentLabels = [];
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
    // #958: "Payment · 30%" for the payments that are a percent of the order.
    if (finiteNumber(payment?.percent_of_order) > 0) percentLabels.push(paymentKindWithPercent(payment.kind, payment.percent_of_order));
  }

  const onHold = ipas?.on_hold === true;
  // The IPAS Status is stored and set by hand (ADR 0054); a cancelled IPAS has none.
  const status = ipas && ipas.state !== IPAS_STATE.CANCELLED ? (ipas.status ?? null) : null;

  // ADR 0036 (amended): the balance reads 0 once a full payment is recorded or the IPAS is
  // filed, because tax withheld from a payment would otherwise leave a settled order owing
  // forever. Read from those facts, never from the status.
  const settled = ipas?.state !== IPAS_STATE.CANCELLED && (hasFullPayment || ipas?.state === IPAS_STATE.FILED);
  let remainingBalance = null;
  if (settled) remainingBalance = 0;
  else if (amount !== null) remainingBalance = fromCents(toCents(amount) - paidCents);

  const overpaidBy = amount !== null && paidCents > toCents(amount) ? fromCents(paidCents - toCents(amount)) : 0;

  // ADR 0055, first match wins: an open ask, a settled balance, anything paid, else not due yet.
  // A cancelled IPAS has none. Overpaid still reads Paid (a balance below zero is a balance of none).
  let paymentStatus = null;
  const paymentAsk = ipas?.payment_ask ?? (ipas?.payment_asks ?? []).find((ask) => !ask?.closed_at) ?? null;
  if (ipas && ipas.state !== IPAS_STATE.CANCELLED) {
    if (paymentAsk) paymentStatus = IPAS_PAYMENT_STATUS.FOR_PAYMENT;
    else if (remainingBalance !== null && remainingBalance <= 0) paymentStatus = IPAS_PAYMENT_STATUS.PAID;
    else if (paidCents > 0) paymentStatus = IPAS_PAYMENT_STATUS.DP_PAID;
    else paymentStatus = IPAS_PAYMENT_STATUS.NOT_DUE_YET;
  }

  return {
    paymentStatus,
    paymentAsk: ipas && ipas.state !== IPAS_STATE.CANCELLED ? paymentAsk : null,
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
    status,
    onHold,
    onHoldNote: onHold ? (ipas?.on_hold_note ?? null) : null,
    remainingBalance,
    overpaidBy,
    paymentMethods: methods,
    paymentScheme: methods.join(PAYMENT_SCHEME_SEPARATOR),
    paymentPercents: percentLabels.join("; "),
  };
}

/**
 * Amount and Remaining balance totals for the rows shown (each carrying `figures`), one entry
 * per currency, in the order each currency first appears:
 * [{ currency, amount, remainingBalance, count }]. Currencies are never added together. A row
 * with no figure adds nothing to that total. `currency` is null for a PO whose currency is unknown.
 */
export function ipasTotalsByCurrency(rows) {
  const byCurrency = new Map();
  for (const row of rows) {
    const { currency = null, amount, remainingBalance } = row.figures ?? {};
    const key = currency ?? null;
    if (!byCurrency.has(key)) byCurrency.set(key, { currency: key, amountCents: 0, remainingCents: 0, count: 0 });
    const total = byCurrency.get(key);
    total.count += 1;
    if (amount !== null && amount !== undefined) total.amountCents += toCents(amount);
    if (remainingBalance !== null && remainingBalance !== undefined) total.remainingCents += toCents(remainingBalance);
  }
  return [...byCurrency.values()].map(({ currency, amountCents, remainingCents, count }) => ({
    currency,
    amount: fromCents(amountCents),
    remainingBalance: fromCents(remainingCents),
    count,
  }));
}
