import { enumerateDateRange } from '@/utils/dateUtils.js';
import { manilaDate, manilaTime } from '@/lib/manilaDate.js';
import { manilaInstant } from './meetingDraft.js';

/**
 * The days of an Activity range (#1056). `edits` is keyed by date: undefined = the form's
 * start and end, { start, end } = that day's own times, null = the day was removed.
 * Weekends are kept: unlike Time Off, an Activity can run on a Saturday.
 */
export function rangeDays(from, to, edits = {}) {
  return enumerateDateRange(from, to).map((date) => ({ date, edit: edits[date] }));
}

/** The days still in the range, each with its own start and end times. */
export function keptDays(from, to, edits, start, end, frozen = new Set()) {
  return rangeDays(from, to, edits)
    .filter((d) => d.edit !== null)
    .map((d) => ({ date: d.date, start: d.edit?.start ?? start, end: d.edit?.end ?? end, frozen: frozen.has(d.date) }));
}

/** The `days` the service sends: ISO instants, first day to last. */
export const daysPayload = (days) => days.map((d) => ({ startsAt: manilaInstant(d.date, d.start), endsAt: manilaInstant(d.date, d.end) }));

/**
 * The form state for a saved request's days: the first and last date, the per-day times, and the
 * dates that have already started. Dates between with no saved day are removed days. A started
 * day always gets its own times so a later change to the form's Start or End cannot move it.
 */
export function daysFromSaved(days, now = new Date()) {
  const sorted = [...days].sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  const first = sorted[0];
  const from = manilaDate(first.starts_at);
  const to = manilaDate(sorted[sorted.length - 1].starts_at);
  const start = manilaTime(first.starts_at);
  const end = manilaTime(first.ends_at);
  const edits = {};
  for (const date of enumerateDateRange(from, to)) edits[date] = null;
  const frozen = new Set();
  for (const d of sorted) {
    const date = manilaDate(d.starts_at);
    const own = { start: manilaTime(d.starts_at), end: manilaTime(d.ends_at) };
    const started = new Date(d.starts_at) <= now;
    if (started) frozen.add(date);
    edits[date] = started || own.start !== start || own.end !== end ? own : undefined;
  }
  return { from, to, start, end, edits, frozen };
}

/** "Mon, Nov 17" for a plain YYYY-MM-DD (no time zone involved). */
export const formatDayLabel = (ymd) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
