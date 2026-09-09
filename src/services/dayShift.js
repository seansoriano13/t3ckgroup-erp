/**
 * The standard working day (issue #150) — 07:30 to 18:00, 18:30 on
 * Wednesdays — used to exist as three string literals, written twice inside
 * ApplyLeaveModal. The two copies disagreed about how to read a date: one
 * read the weekday in local time, the other in UTC, so near midnight they
 * could decide it was a different day.
 *
 * This is the one place that answers "what is the shift for this date" and
 * "is this date a working day", both reading the date the same way the
 * shared weekend rule in leaveRules.js already does — UTC — so the
 * disagreement disappears rather than being resolved twice.
 *
 * The shift is a default for pre-filling a form only. It is never enforced
 * or validated against, and a record keeps the times it was actually filed
 * with even after this configuration changes.
 */

/**
 * Seeded values, identical to the literals this replaced. Used whenever the
 * database hasn't answered yet, so a form still pre-fills instantly.
 */
export const DEFAULT_DAY_SHIFT_CONFIG = [
  { weekday: 0, startTime: null, endTime: null, isWorkingDay: false }, // Sunday
  { weekday: 1, startTime: '07:30', endTime: '18:00', isWorkingDay: true },
  { weekday: 2, startTime: '07:30', endTime: '18:00', isWorkingDay: true },
  { weekday: 3, startTime: '07:30', endTime: '18:30', isWorkingDay: true }, // Wednesday
  { weekday: 4, startTime: '07:30', endTime: '18:00', isWorkingDay: true },
  { weekday: 5, startTime: '07:30', endTime: '18:00', isWorkingDay: true },
  { weekday: 6, startTime: null, endTime: null, isWorkingDay: false }, // Saturday
];

/**
 * The shift for `dateStr` ("YYYY-MM-DD"): its start/end time and whether it
 * is a working day at all. Reads the weekday in UTC, matching
 * `assertNotWeekend` in leaveRules.js, so a date near midnight resolves to
 * the same weekday no matter the caller's local offset.
 */
export function getShiftForDate(dateStr, config = DEFAULT_DAY_SHIFT_CONFIG) {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return { startTime: null, endTime: null, isWorkingDay: false };
  }
  const weekday = parsed.getUTCDay();
  const day = config.find((d) => d.weekday === weekday) ?? DEFAULT_DAY_SHIFT_CONFIG[weekday];
  return { startTime: day.startTime, endTime: day.endTime, isWorkingDay: day.isWorkingDay };
}

/**
 * Whether `dateStr` is a configured working day.
 */
export function isWorkingDay(dateStr, config = DEFAULT_DAY_SHIFT_CONFIG) {
  return getShiftForDate(dateStr, config).isWorkingDay;
}
