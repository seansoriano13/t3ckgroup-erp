const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Countdown to a Group Task's Due Date.
 * Returns null when there is no (valid) due date, so old rows stay quiet.
 * { label, overdue }: "N days left", "N hours left" under a day,
 * "Overdue by N days" once past (at least 1 day, rounded down).
 */
export function getDueCountdown(dueDate, now = new Date()) {
  if (!dueDate) return null;
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return null;
  const diff = due - new Date(now).getTime();

  if (diff < 0) {
    const days = Math.max(1, Math.floor(-diff / DAY_MS));
    return { label: `Overdue by ${days} ${days === 1 ? "day" : "days"}`, overdue: true };
  }
  if (diff < DAY_MS) {
    const hours = Math.max(1, Math.ceil(diff / HOUR_MS));
    return { label: `${hours} ${hours === 1 ? "hour" : "hours"} left`, overdue: false };
  }
  const days = Math.floor(diff / DAY_MS);
  return { label: `${days} ${days === 1 ? "day" : "days"} left`, overdue: false };
}

/** A stored due date as the "YYYY-MM-DD" a date input wants: the local calendar day. */
export function dueDateInputValue(dueDate) {
  if (!dueDate) return "";
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
