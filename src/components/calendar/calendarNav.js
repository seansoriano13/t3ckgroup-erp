import { addDays, addMonths, format } from 'date-fns';
import { manilaDate, manilaToday, parseManilaDate, weekGrid } from '@/lib/manilaDate.js';
import { monthRange } from './monthWeeks.js';

/** The Calendar's two layouts: the month with a day rail, and the Gantt chart. */
export const LAYOUTS = ['calendar', 'gantt'];

/** How many weeks the Gantt shows. */
export const GANTT_WEEKS = [2, 4];

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read `?layout=&date=&weeks=` from the URL. A missing or bad layout falls back
 * to `remembered` (the viewer's last pick), then to the month; a bad date falls
 * back to today (Manila); weeks fall back to two.
 */
export function parseCalendarParams(params, today = manilaToday(), remembered = null) {
  const pick = params.get('layout') ?? remembered;
  const layout = LAYOUTS.includes(pick) ? pick : 'calendar';
  const raw = params.get('date');
  const date = raw && YMD.test(raw) && manilaDate(parseManilaDate(raw)) === raw ? raw : today;
  const weeks = GANTT_WEEKS.includes(Number(params.get('weeks'))) ? Number(params.get('weeks')) : GANTT_WEEKS[0];
  return { layout, date, weeks };
}

/** The Gantt's days: `weeks` whole weeks from the Monday of the selected date's week. */
export function ganttDays(date, weeks) {
  const monday = weekGrid(date)[0];
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const day = addDays(monday, i);
    return { date: day, ymd: manilaDate(day), weekend: i % 7 > 4 };
  });
}

/** The Manila date range the server read must cover for a layout. */
export function layoutRange(layout, date, weeks = GANTT_WEEKS[0]) {
  if (layout === 'gantt') {
    const days = ganttDays(date, weeks);
    return { from: days[0].ymd, to: days[days.length - 1].ymd };
  }
  return monthRange(date);
}

/** Move the selected date one step (previous = -1, next = +1): a month, or a week on the Gantt. */
export function shiftDate(layout, date, by) {
  const base = parseManilaDate(date);
  if (layout === 'gantt') return manilaDate(addDays(base, 7 * by));
  return manilaDate(addMonths(base, by));
}

/** The toolbar title: "October 2026", or "Oct 19 to Nov 1, 2026" on the Gantt. */
export function layoutTitle(layout, date, weeks = GANTT_WEEKS[0]) {
  if (layout === 'gantt') {
    const days = ganttDays(date, weeks);
    return `${format(days[0].date, 'MMM d')} to ${format(days[days.length - 1].date, 'MMM d, yyyy')}`;
  }
  return format(parseManilaDate(date), 'MMMM yyyy');
}
