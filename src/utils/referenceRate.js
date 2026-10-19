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
 * How far a typed rate sits from the Reference Rate, and whether that is beyond the
 * currency's threshold. Null when either number is missing. It flags; it never blocks.
 */
export function rateDivergence(typedRate, rate) {
  const typed = Number(typedRate);
  const reference = Number(rate?.php_per_unit);
  if (!typedRate || !rate || !Number.isFinite(typed) || typed <= 0 || !(reference > 0)) return null;
  const pct = (Math.abs(typed - reference) / reference) * 100;
  const threshold = Number(rate.divergence_pct) || 2;
  return { pct, flagged: pct > threshold + 1e-9 };
}
