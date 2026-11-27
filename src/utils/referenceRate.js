/**
 * Reference Rate display (#317). A Reference Rate is always shown with the day it is
 * for: never as live, never blank-dated, never re-stamped with today.
 */

import { getCurrentLocalDate } from "./formatDate.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "17 Sep", or "17 Sep 2026" when `today` is in another year. Reads YYYY-MM-DD as a plain day. */
export function formatRateDay(rateDate, today = getCurrentLocalDate()) {
  const [year, month, day] = String(rateDate).split("-").map(Number);
  const label = `${day} ${MONTHS[month - 1]}`;
  return String(today).slice(0, 4) === String(year) ? label : `${label} ${year}`;
}

/** The PHP figure as the feed gave it: at least two decimals, at most four. */
export function formatRateNumber(value) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** "USD 1 = ₱58.20 · 17 Sep". Blank when there is no rate. */
export function formatReferenceRate(rate, today) {
  if (!rate) return "";
  return `${rate.currency} 1 = ₱${formatRateNumber(rate.php_per_unit)} · ${formatRateDay(rate.rate_date, today)}`;
}

/**
 * The typo check on a paid payment (#1278): the rate worked out from the pesos and the foreign amount is under a
 * tenth or over ten times the day's Reference Rate. Null when either is missing. It never blocks and the
 * Reference Rate is never named to the user: this is for a missing or extra zero only.
 */
export function rateTypo(workedRate, rate) {
  const worked = Number(workedRate);
  const reference = Number(rate?.php_per_unit);
  if (!(worked > 0) || !(reference > 0)) return null;
  return worked < reference / 10 || worked > reference * 10 ? { rate: worked } : null;
}
