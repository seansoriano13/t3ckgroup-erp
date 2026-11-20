/**
 * Spec #1123 (D1, C1): how long or how big a typed value may be. The same numbers are checked by the
 * database (migration 20261220030000_1128_limits_links.sql), so the form can say it first, in words.
 */
export const IPAS_LIMITS = {
  piNumber: 60,
  receiptRef: 60,
  remarks: 2000,
  contact: 200,
  piQtAmount: 9_999_999_999.99,
  boxWeightKg: 5000,
  boxText: 200,
  contentQuantity: 100_000,
};

const count = (n) => n.toLocaleString("en-US");

/** The sentence for a text that is too long, or null. `what` reads "P.I #", "Remarks"... */
export function textLengthIssue(value, what, max) {
  if (typeof value !== "string" || value.trim().length <= max) return null;
  return `${what} can be at most ${count(max)} characters.`;
}

/** The sentence for a P.I/QT Amount that is too big, or null. Parsing is somebody else's rule. */
export function amountSizeIssue(value) {
  return Number.isFinite(value) && value > IPAS_LIMITS.piQtAmount
    ? `P.I/QT Amount is at most ${IPAS_LIMITS.piQtAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}.`
    : null;
}

/** The sentence for a box weight in kg that is out of range, or null (blank is fine). */
export function boxWeightIssue(raw) {
  if (raw === "" || raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Gross weight must be a number.";
  if (n < 0) return "A box can't weigh less than 0 kg.";
  if (n > IPAS_LIMITS.boxWeightKg) return `A box can weigh at most ${count(IPAS_LIMITS.boxWeightKg)} kg.`;
  return null;
}

/** The sentence for a contents quantity that is out of range, or null. */
export function contentQuantityIssue(raw) {
  const n = Number(raw);
  if (!(n > 0)) return "Every content needs a quantity above zero.";
  if (n > IPAS_LIMITS.contentQuantity) return `A content's quantity is at most ${count(IPAS_LIMITS.contentQuantity)}.`;
  return null;
}

/** A weight as people read it: "1,250.00 kg". Blank when there is none. */
export function formatKg(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return "";
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
}
