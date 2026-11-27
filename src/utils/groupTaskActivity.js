import { manilaToday } from '@/lib/manilaDate.js';
import { defaultSlot, latestDate } from '@/components/calendar/meetingDraft.js';

/**
 * Group Task on the Calendar (#1250, spec #1246). Plain functions, so the Group Task window and the
 * Activity form agree on one rule each.
 */

/**
 * The days the Activity form opens on for a Group Task: the Start Date (or today when it has passed or is
 * blank) through the Due Date, ending no later than the one-year limit. A Due Date that has passed, or is
 * not after the first day, gives that one day only (`dateTo` ''). Dates are 'YYYY-MM-DD' (Manila).
 */
export function groupTaskDays({ startDate, dueDate }, rules, now = new Date()) {
  const today = manilaToday(now);
  const limit = latestDate(now);
  // A Start Date past the one-year limit opens on the limit day, so the form never opens on a day the server refuses.
  const wanted = startDate && startDate > today ? (startDate > limit ? limit : startDate) : today;
  // "Today" is today only while a slot is left; the form's usual default time rolls to tomorrow otherwise.
  const { date } = defaultSlot(rules, now, wanted);
  const due = dueDate ? String(dueDate).slice(0, 10) : '';
  const end = due && due > limit ? limit : due;
  return { date, dateTo: end && end > date ? end : '' };
}

/**
 * Open in Calendar: the id of the Activity's next day that has not ended yet, or its last day when every
 * day has passed. `days` are the Activity's day rows ({ id, starts_at, ends_at }).
 */
export function dayToOpen(days, now = new Date()) {
  const sorted = [...(days ?? [])].sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  if (sorted.length === 0) return null;
  return (sorted.find((d) => new Date(d.ends_at) >= now) ?? sorted[sorted.length - 1]).id;
}

/** Which of the three states the Group Task window's button is in: 'add', 'open' or null (nothing). */
export function calendarButtonState({ liveActivity, typeOn, taskStatus }) {
  if (liveActivity) return 'open';
  if (typeOn && taskStatus !== 'CANCELLED') return 'add';
  return null;
}
