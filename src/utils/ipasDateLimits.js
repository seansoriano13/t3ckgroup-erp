import { manilaDay } from "./orderStanding";

/** Spec #1123 (A3): a payment, a charge and the typed Delivered / Import Clearance dates run from here to today (Asia/Manila). */
export const IPAS_DATE_MIN = "2015-01-01";

/** Today in Asia/Manila, as 'YYYY-MM-DD'. */
export function ipasDateMax() {
  return manilaDay(Date.now());
}

/**
 * The sentence for a date that is outside the limits, or null when it is fine (or blank:
 * a blank is somebody else's rule). `what` reads "The payment date", "The charge date"...
 */
export function ipasDateIssue(value, what = "The date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (value > ipasDateMax()) return `${what} cannot be after today.`;
  if (value < IPAS_DATE_MIN) return `${what} cannot be before January 1, 2015.`;
  return null;
}
