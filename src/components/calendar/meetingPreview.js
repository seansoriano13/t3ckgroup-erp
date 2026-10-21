import { manilaTime } from '@/lib/manilaDate.js';

/** Kinds of Time Off that make someone unavailable (overtime and undertime do not). */
const TIME_OFF_KINDS = new Set(['SIL', 'LWOP', 'OFFSET']);
const TIME_OFF_LABEL = { SIL: 'SIL', LWOP: 'LWOP', OFFSET: 'Offset' };

const overlaps = (aStart, aEnd, bStart, bEnd) => new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);

export const isMeeting = (entry) => entry.kind === 'MEETING';

/** Meetings held at one Venue (by name), earliest first. Pending and returned ones are held too. */
export function venueMeetings(entries, venueName) {
  return entries
    .filter((e) => isMeeting(e) && e.venue === venueName)
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
}

/** The meeting at this Venue that overlaps the chosen window, or null. */
export function findClash(entries, venueName, startsAt, endsAt) {
  return venueMeetings(entries, venueName).find((e) => overlaps(e.starts_at, e.ends_at, startsAt, endsAt)) ?? null;
}

export function clashMessage(entry) {
  return (
    `${entry.venue} is already held ${manilaTime(entry.starts_at)} to ${manilaTime(entry.ends_at)} ` +
    `for "${entry.title}" (requested by ${entry.employee?.name ?? 'someone'}). Pick another time.`
  );
}

/**
 * Soft warnings that never block: the Facilitator or a Participant on approved Time Off that day,
 * or in an overlapping meeting at the other Venue. `people` is [{ id, name }].
 */
export function softWarnings(entries, { people, venueName, startsAt, endsAt }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const out = [];
  for (const e of entries) {
    if (TIME_OFF_KINDS.has(e.kind) && e.status === 'APPROVED' && byId.has(e.employee?.id)) {
      out.push(`${byId.get(e.employee.id).name} is on approved ${TIME_OFF_LABEL[e.kind]} that day.`);
    }
    if (isMeeting(e) && e.venue !== venueName && overlaps(e.starts_at, e.ends_at, startsAt, endsAt)) {
      const d = e.details ?? {};
      const inIt = [d.facilitator, ...(d.participants ?? [])].filter((p) => p && byId.has(p.id));
      for (const p of inIt) {
        out.push(
          `${byId.get(p.id).name} is in another meeting at ${e.venue}, ${manilaTime(e.starts_at)} to ${manilaTime(e.ends_at)}.`,
        );
      }
    }
  }
  return [...new Set(out)];
}
