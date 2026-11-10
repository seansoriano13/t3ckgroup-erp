import { manilaDate, monthGrid, parseManilaDate } from '@/lib/manilaDate.js';

/**
 * The month as Monday-first weeks of seven cells (ADR 0039). A month that starts
 * on a Sunday pulls in the six days before it; one can span six weeks. `inMonth`
 * is false for the spill-over days.
 */
export function monthWeeks(anyDayInMonth) {
  const anchor = typeof anyDayInMonth === 'string' ? parseManilaDate(anyDayInMonth) : anyDayInMonth;
  const month = manilaDate(anchor).slice(0, 7);
  const days = monthGrid(anyDayInMonth).map((date) => {
    const ymd = manilaDate(date);
    return { date, ymd, inMonth: ymd.slice(0, 7) === month };
  });
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** First and last Manila dates the month grid covers, for the server read. */
export function monthRange(anyDayInMonth) {
  const weeks = monthWeeks(anyDayInMonth);
  return { from: weeks[0][0].ymd, to: weeks[weeks.length - 1][6].ymd };
}
