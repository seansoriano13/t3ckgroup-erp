import { addDays, addMonths, format } from 'date-fns';
import { manilaDate, manilaToday, parseManilaDate, weekGrid } from '@/lib/manilaDate.js';
import { monthRange } from './monthWeeks.js';

export const VIEWS = ['month', 'people', 'week', 'day'];

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Read `?view=&date=` from the URL; bad or missing values fall back to month and today (Manila). */
export function parseCalendarParams(params, today = manilaToday()) {
  const view = VIEWS.includes(params.get('view')) ? params.get('view') : 'month';
  const raw = params.get('date');
  const date = raw && YMD.test(raw) && manilaDate(parseManilaDate(raw)) === raw ? raw : today;
  return { view, date };
}

/** The Manila date range the server read must cover for a view. */
export function viewRange(view, date) {
  if (view === 'week') {
    const days = weekGrid(date);
    return { from: manilaDate(days[0]), to: manilaDate(days[6]) };
  }
  if (view === 'day') return { from: date, to: date };
  return monthRange(date);
}

/** Move the selected date one step (previous = -1, next = +1) in the view's unit. */
export function shiftDate(view, date, by) {
  const base = parseManilaDate(date);
  if (view === 'week') return manilaDate(addDays(base, 7 * by));
  if (view === 'day') return manilaDate(addDays(base, by));
  return manilaDate(addMonths(base, by));
}

/** The toolbar title for a view. */
export function viewTitle(view, date) {
  const base = parseManilaDate(date);
  if (view === 'week') {
    const days = weekGrid(date);
    return `${format(days[0], 'MMM d')} to ${format(days[6], 'MMM d, yyyy')}`;
  }
  if (view === 'day') return format(base, 'EEEE, MMM d, yyyy');
  return format(base, 'MMMM yyyy');
}
