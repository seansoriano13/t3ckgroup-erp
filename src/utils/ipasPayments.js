/**
 * Payments and charges of an IPAS, as the screens read them (spec #241, #244).
 * Pure helpers: no network, no React. The numbers that decide anything (the
 * rate, the spread) are in landedCost.js; this file shapes rows, derives the
 * header amounts and reads what people type.
 */

import { IPAS_PAYMENT_KIND } from "../constants/ipas";
import { finiteNumber, isPhpCurrency, paymentPhp } from "./landedCost";

/**
 * Reads an amount someone typed ("1,250", "₱ 1 250.50", "", "12."). Never
 * throws and never returns NaN: `{ ok: true, value }` (value is null when it is
 * blank) or `{ ok: false }` for anything that isn't a plain non-negative number.
 */
export function parseAmountInput(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? { ok: true, value: raw } : { ok: false };
  }
  const text = String(raw).replace(/[₱,\s]/g, "").replace(/^(php|usd)/i, "");
  if (text === "") return { ok: true, value: null };
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return { ok: false };
  const value = Number(text);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

/** `2026-10-13` -> true; anything else (including a half-typed date) -> false. */
export function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A date-only value (`2026-10-13`) as "Oct 13, 2026", read as written so the
 * viewer's timezone can't move it a day. Anything else comes back as is.
 */
export function formatDay(value) {
  if (!isIsoDate(value)) return value ? String(value) : "—";
  const [year, month, day] = value.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/**
 * A payment row with its method and who recorded it. `options` is a Map of
 * ipas_options id -> row; a method the list no longer shows still resolves,
 * because options are deactivated, never deleted.
 */
export function shapePayment(row, options = new Map()) {
  const method = options.get(row.method_id) ?? null;
  return {
    ...row,
    amount: finiteNumber(row.amount),
    php_debited: finiteNumber(row.php_debited),
    charge_fee_php: finiteNumber(row.charge_fee_php) ?? 0,
    method,
    methodLabel: method?.label ?? null,
    hasProof: Boolean(row.proof_url),
  };
}

/** A charge row with its kind. */
export function shapeCharge(row, options = new Map()) {
  const kind = options.get(row.kind_id) ?? null;
  return {
    ...row,
    amount_php: finiteNumber(row.amount_php) ?? 0,
    kind,
    kindLabel: kind?.label ?? null,
  };
}

/**
 * The header amounts derived from the rows. DP and FP are the sums of the
 * Down payment and Full payment rows (in the PO's currency). No balance is
 * computed: the P.I/QT Amount is typed and nothing is subtracted from it.
 *
 *   downPayment, fullPayment   PO currency
 *   paid                       every payment row's amount, PO currency
 *   phpDebited                 the PHP those payments cost (a PHP PO's amounts)
 *   chargeFeesPhp              the banks' charge fees on payments
 *   chargesPhp                 the charge rows
 *   totalDebitedPhp            phpDebited + chargeFeesPhp, as the printed form's footer
 *   missingPhp                 payments on a foreign PO with no PHP debited
 *   hasProof                   any payment carries proof of payment (With P.O.P)
 */
export function summarizePayments(payments = [], charges = [], currency = null) {
  const isPhp = isPhpCurrency(currency);
  let downPayment = 0;
  let fullPayment = 0;
  let paid = 0;
  let phpDebited = 0;
  let chargeFeesPhp = 0;
  let missingPhp = 0;
  let hasProof = false;

  for (const payment of payments) {
    const amount = finiteNumber(payment?.amount) ?? 0;
    paid += amount;
    if (payment?.kind === IPAS_PAYMENT_KIND.DOWN_PAYMENT) downPayment += amount;
    if (payment?.kind === IPAS_PAYMENT_KIND.FULL_PAYMENT) fullPayment += amount;
    const php = paymentPhp(payment, isPhp);
    if (php === null) missingPhp += 1;
    else phpDebited += php;
    chargeFeesPhp += finiteNumber(payment?.charge_fee_php) ?? 0;
    if (payment?.proof_url) hasProof = true;
  }

  const chargesPhp = charges.reduce((sum, charge) => sum + (finiteNumber(charge?.amount_php) ?? 0), 0);
  const round = (n) => Math.round(n * 100) / 100;

  return {
    count: payments.length,
    downPayment: round(downPayment),
    fullPayment: round(fullPayment),
    paid: round(paid),
    phpDebited: round(phpDebited),
    chargeFeesPhp: round(chargeFeesPhp),
    chargesPhp: round(chargesPhp),
    totalDebitedPhp: round(phpDebited + chargeFeesPhp),
    missingPhp,
    hasProof,
  };
}

/** Option rows of one list for a picker: active ones, plus the one a row already holds. */
export function optionsForPicker(options = [], list, currentId = null) {
  return options
    .filter((option) => option.list === list && (option.active || option.id === currentId))
    .sort((a, b) => a.sort - b.sort || String(a.label).localeCompare(String(b.label)));
}
