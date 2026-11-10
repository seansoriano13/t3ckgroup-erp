import { format } from "date-fns";

// SOR dates are stored as "YYYY-MM-DD". Forms show them as "Nov 5, 2026",
// the same as the lists. A native date input would show the browser's own
// order (11/05/2026 for a US setting), so the forms use a picker instead.
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The stored "YYYY-MM-DD" as a local Date, or null when there is no date. */
export function ymdToDate(value) {
  const match = YMD.exec(value || "");
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

/** A stored date as "Nov 5, 2026"; "" when there is no date. */
export function formatSorDate(value) {
  const date = ymdToDate(value);
  return date ? format(date, "MMM d, yyyy") : "";
}
