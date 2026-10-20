const MANILA = "Asia/Manila";
const DAY_ONLY = { timeZone: MANILA, month: "short", day: "numeric", year: "numeric" };

/**
 * A Transmittal's prepared time as people read it, in Manila time:
 * "Oct 15, 2026, 5:00 PM". Slips from before the time was kept sit at midnight
 * Manila, and a bare date has no time at all: both read as just the day, so an
 * old slip never claims 12:00 AM. `{ dayOnly: true }` always gives the day.
 */
export function formatPreparedAt(value, { dayOnly = false } = {}) {
  if (!value) return "";
  const bareDay = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const at = new Date(bareDay ? `${value}T00:00:00+08:00` : value);
  if (Number.isNaN(at.getTime())) return String(value);
  const day = at.toLocaleDateString("en-US", DAY_ONLY);
  if (dayOnly || bareDay) return day;
  const time = at.toLocaleTimeString("en-US", { timeZone: MANILA, hour: "numeric", minute: "2-digit", hour12: true });
  return /^12:00\s?AM$/.test(time) ? day : `${day}, ${time}`;
}
