/**
 * "% of order" on an IPAS payment (#958, spec #954). Pure: no network, no React.
 *
 * A Down payment or Payment may carry a percent. Typing it fills the amount as
 * percent x the P.I/QT Amount, or x the PO total when the P.I/QT Amount is blank
 * (the old sheet's I16 = K9 * H16). The amount stays editable, and typing a
 * different amount by hand clears the percent, so a printed percent is never wrong.
 * Percents over 100%, or payments over the order amount, are warnings only.
 */

import { IPAS_PAYMENT_KIND, IPAS_PAYMENT_KIND_LABELS } from "../constants/ipas";
import { finiteNumber, fromCents, toCents } from "./landedCost";
import { parseAmountInput } from "./ipasPayments";

/** Where the percent is taken from. */
export const PERCENT_BASE = { PI_QT: "pi_qt", PO_TOTAL: "po_total" };

export const PERCENT_BASE_LABELS = {
  [PERCENT_BASE.PI_QT]: "P.I/QT Amount",
  [PERCENT_BASE.PO_TOTAL]: "PO total",
};

/** Only these kinds can be a percent of the order. */
export const percentApplies = (kind) => kind === IPAS_PAYMENT_KIND.DOWN_PAYMENT || kind === IPAS_PAYMENT_KIND.PAYMENT;

/**
 * The amount a percent is worked out from: the P.I/QT Amount when it is given,
 * else the PO total. `null` when neither is known (the percent can't fill the amount).
 */
export function percentBase({ piQtAmount, poTotal } = {}) {
  const pi = finiteNumber(piQtAmount);
  if (pi !== null && pi > 0) return { source: PERCENT_BASE.PI_QT, amount: pi, label: PERCENT_BASE_LABELS[PERCENT_BASE.PI_QT] };
  const po = finiteNumber(poTotal);
  if (po !== null && po > 0) return { source: PERCENT_BASE.PO_TOTAL, amount: po, label: PERCENT_BASE_LABELS[PERCENT_BASE.PO_TOTAL] };
  return null;
}

/** Reads what was typed into the percent box: `{ ok, value }`, blank is `value: null`. Zero is not a percent. */
export function parsePercentInput(raw) {
  const text = typeof raw === "string" ? raw.replace(/%/g, "") : raw;
  const read = parseAmountInput(text);
  if (!read.ok) return { ok: false, value: null };
  if (read.value === null) return { ok: true, value: null };
  return read.value > 0 && read.value <= 1000 ? { ok: true, value: Math.round(read.value * 1e4) / 1e4 } : { ok: false, value: null };
}

/** percent x base, rounded to the centavo. `null` when either is missing or the percent is not usable. */
export function amountFromPercent(percent, base) {
  const read = parsePercentInput(percent);
  const amount = base && typeof base === "object" ? base.amount : base;
  if (!read.ok || read.value === null || finiteNumber(amount) === null) return null;
  return fromCents(Math.round((toCents(amount) * read.value) / 100));
}

/** 30 -> "30", 12.5 -> "12.5", 33.3333 -> "33.3333". */
export function formatPercent(value) {
  const n = finiteNumber(value);
  return n === null ? "" : String(Math.round(n * 1e4) / 1e4);
}

/** "Payment · 30%" when the payment carries a percent, else just the kind label. */
export function paymentKindWithPercent(kind, percent) {
  const label = IPAS_PAYMENT_KIND_LABELS[kind] ?? kind ?? "";
  const n = finiteNumber(percent);
  return n !== null && n > 0 && percentApplies(kind) ? `${label} · ${formatPercent(n)}%` : label;
}

/**
 * A payment row's percent and amount after one of them is typed.
 *   { field: "percent", value, base }  fills the amount (kept as typed when there is no base)
 *   { field: "amount", value }         clears the percent: the amount is now by hand
 *   { field: "kind", value }           clears the percent on a kind that can't carry one
 * Returns the patch for the row ({ percentOfOrder, amount? }), as text like the form holds it.
 */
export function afterPercentEdit(row, edit) {
  if (edit.field === "percent") {
    const read = parsePercentInput(edit.value);
    const patch = { percentOfOrder: edit.value };
    if (read.ok && read.value !== null) {
      const amount = amountFromPercent(read.value, edit.base);
      if (amount !== null) patch.amount = String(amount);
    }
    return patch;
  }
  if (edit.field === "amount") {
    // The same figure the percent filled in is not "by hand".
    const base = edit.base ?? null;
    const typed = parseAmountInput(edit.value);
    const filled = base ? amountFromPercent(row.percentOfOrder, base) : null;
    if (typed.ok && filled !== null && typed.value === filled) return { amount: edit.value };
    return { amount: edit.value, percentOfOrder: "" };
  }
  if (edit.field === "kind") {
    return percentApplies(edit.value) ? { kind: edit.value } : { kind: edit.value, percentOfOrder: "" };
  }
  return {};
}

/**
 * The two warnings, never a block.
 *   percentOver   the percents of the payments add up to more than 100%: { total }
 *   amountOver    the payments add up to more than the order amount: { paid, order, over }
 * `payments` are rows with `amount` and `percentOfOrder` (form) or `percent_of_order` (stored).
 * `orderAmount` is the P.I/QT Amount, else the PO total (null when unknown: no amount warning).
 */
export function paymentWarnings(payments = [], orderAmount = null) {
  let percentCents = 0;
  let paidCents = 0;
  for (const payment of payments) {
    const percent = parsePercentInput(payment?.percentOfOrder ?? payment?.percent_of_order);
    if (percent.ok && percent.value !== null) percentCents += Math.round(percent.value * 1e4);
    const amount = parseAmountInput(payment?.amount);
    if (amount.ok && amount.value !== null) paidCents += toCents(amount.value);
  }
  const warnings = { percentOver: null, amountOver: null };
  if (percentCents > 100 * 1e4) warnings.percentOver = { total: percentCents / 1e4 };
  const order = finiteNumber(orderAmount);
  if (order !== null && order > 0 && paidCents > toCents(order)) {
    warnings.amountOver = { paid: fromCents(paidCents), order, over: fromCents(paidCents - toCents(order)) };
  }
  return warnings;
}
