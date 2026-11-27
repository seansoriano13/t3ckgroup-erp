/**
 * Payments and charges of an IPAS, as the screens read them (spec #241, #244).
 * Pure helpers: no network, no React. The numbers that decide anything (the
 * rate, the spread) are in landedCost.js; this file shapes rows, derives the
 * header amounts and reads what people type.
 */

import { IPAS_PAYMENT_KIND } from "../constants/ipas";
import { finiteNumber, fromCents, isPhpCurrency, paymentPhp, paymentRate, toCents } from "./landedCost";
import { isIsoDate } from "./dateUtils";

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

/**
 * Pesos typed from the bank paper replace any stored rate (#1278). Reads both boxes as numbers:
 * `pesos` is the typed pesos (null when blank or not above zero), `rate` the stored rate, null once pesos are typed.
 */
export function pesosReplaceRate(phpDebited, forexRate) {
  const typed = parseAmountInput(phpDebited).value;
  const pesos = typed !== null && typed > 0 ? typed : null;
  return { pesos, rate: pesos !== null ? null : parseAmountInput(forexRate).value };
}

// Moved to the shared date helpers; re-exported so IPAS callers keep their import.
export { isIsoDate };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A date-only value (`2026-10-13`) as "Oct 13, 2026", read as written so the
 * viewer's timezone can't move it a day. Anything else comes back as is.
 */
export function formatDay(value) {
  if (!isIsoDate(value)) {
    if (!value) return "—";
    // A timestamp (a stamp from the TG03 slips) reads as its day where the viewer is.
    const at = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null;
    if (at && !Number.isNaN(at.getTime())) return `${MONTHS[at.getMonth()]} ${at.getDate()}, ${at.getFullYear()}`;
    return String(value);
  }
  const [year, month, day] = value.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th", 21 -> "21st". */
export function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

/**
 * The payments in display order with their numbers (#1211): by payment date, then the order the rows were
 * created in. Worked out each time, never stored. `[{ payment, number: "1st" }, ...]`.
 */
export function numberPayments(payments = []) {
  return payments
    .map((payment, index) => ({ payment, index }))
    .sort((a, b) => {
      const byDay = String(a.payment?.paid_on ?? "").localeCompare(String(b.payment?.paid_on ?? ""));
      if (byDay) return byDay;
      const byTime = String(a.payment?.created_at ?? "").localeCompare(String(b.payment?.created_at ?? ""));
      return byTime || a.index - b.index;
    })
    .map(({ payment }, position) => ({ payment, number: ordinal(position + 1) }));
}

/** True for the "Others" payment method (its label, as the list shows it). */
export const isOthersMethod = (label) => /^others?$/i.test(String(label ?? "").trim());

/** A payment's proof files, oldest first. A proof that was only a link (no file rows yet) reads as one file. */
export function paymentProofFiles(row) {
  const rows = [...(row?.ipas_payment_files ?? row?.proofFiles ?? [])].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );
  const files = rows.map((file) => ({ id: file.id ?? file.url, url: file.url, fileName: file.file_name ?? file.fileName ?? "Proof of payment" }));
  if (files.length === 0 && row?.proof_url) return [{ id: row.proof_url, url: row.proof_url, fileName: "Proof of payment" }];
  return files;
}

/** True when the payment has at least one proof file: what a required proof asks for. */
export const paymentHasProof = (payment) => paymentProofFiles(payment).length > 0;

/**
 * A payment row with its method and who recorded it. `options` is a Map of
 * ipas_options id -> row; a method the list no longer shows still resolves,
 * because options are deactivated, never deleted.
 */
export function shapePayment(row, options = new Map()) {
  const method = options.get(row.method_id) ?? null;
  const proofFiles = paymentProofFiles(row);
  // "Others" reads as what was typed, on screen, in the print and in the Payment scheme (#1211).
  const typed = typeof row.method_other === "string" ? row.method_other.trim() : "";
  const methodLabel = method && isOthersMethod(method.label) && typed ? typed : (method?.label ?? null);
  return {
    ...row,
    amount: finiteNumber(row.amount),
    php_debited: finiteNumber(row.php_debited),
    charge_fee_php: finiteNumber(row.charge_fee_php) ?? 0,
    forex_rate: finiteNumber(row.forex_rate),
    percent_of_order: finiteNumber(row.percent_of_order),
    doc_stamp_php: finiteNumber(row.doc_stamp_php) ?? 0,
    misc_fee_php: finiteNumber(row.misc_fee_php) ?? 0,
    // charge_fee_php holds every fee (#708); the bank charge is what is left after the other two.
    bank_charge_php: Math.max(0, fromCents(toCents(finiteNumber(row.charge_fee_php) ?? 0) - toCents(finiteNumber(row.doc_stamp_php) ?? 0) - toCents(finiteNumber(row.misc_fee_php) ?? 0))),
    rate: paymentRate(row),
    method,
    methodLabel,
    proofFiles,
    hasProof: proofFiles.length > 0,
  };
}

/** A charge row with its kind. */
export function shapeCharge(row, options = new Map()) {
  const kind = options.get(row.kind_id) ?? null;
  return {
    ...row,
    // Null is a blank charge, an amount not yet known (#709); it counts as nothing in a sum.
    amount_php: finiteNumber(row.amount_php),
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
    if (paymentHasProof(payment)) hasProof = true;
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
