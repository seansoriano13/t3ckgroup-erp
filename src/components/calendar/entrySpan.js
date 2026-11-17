import { manilaTime } from '@/lib/manilaDate.js';

/** Kinds that take a person out for whole days; they draw as bars across those days. */
export const TIME_OFF_KINDS = new Set(['SIL', 'OFFSET', 'LWOP']);

/** Whether an entry takes its person out of the office (whole days or undertime). */
export const isOut = (entry) => TIME_OFF_KINDS.has(entry.kind) || entry.kind === 'UNDERTIME';

/**
 * A Time Off entry or an Activity with its whole request attached. The server sends one row
 * per day, so a 3-day SIL is three rows sharing a group_id. `span` holds the
 * first and last date, the number of days and the total hours, within the
 * range the Calendar loaded. Other entries come back unchanged.
 */
export function withSpan(entry, entries) {
  if (!entry || !entry.group_id || !(TIME_OFF_KINDS.has(entry.kind) || entry.kind === 'MEETING')) return entry;
  const group = (entries ?? [])
    .filter((e) => e.kind === entry.kind && e.group_id === entry.group_id)
    .sort((a, b) => a.manila_date.localeCompare(b.manila_date));
  if (group.length === 0) return entry;
  return {
    ...entry,
    span: {
      first: group[0].manila_date,
      last: group[group.length - 1].manila_date,
      days: group.length,
      hours: group.reduce((h, e) => h + Number(e.hours ?? 0), 0),
      // Every day with its own times, for an Activity's details.
      items: group.map((e) => ({ id: e.id, date: e.manila_date, starts_at: e.starts_at, ends_at: e.ends_at, all_day: e.all_day })),
    },
  };
}

/** Initials for a name, two letters at most. */
export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/** "Andrea Villanueva" → "Andrea V." */
export const shortName = (name = '') => {
  const [first, ...rest] = name.split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
};

/** A short Manila clock time: "9a", "1:30p". */
export function time12(iso) {
  const [h, m] = manilaTime(iso).split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`;
}

/** An Activity that runs over more than one day: it draws as one bar across them. */
export const isMultiDayActivity = (entry) => entry.kind === 'MEETING' && Number(entry.details?.days_total ?? 1) > 1;
