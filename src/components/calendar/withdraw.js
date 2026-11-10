import { manilaToday } from '@/lib/manilaDate.js';

/** Kinds a person can take back themselves. Overtime and Undertime withdraw from My Requests. */
export const WITHDRAWABLE_KINDS = ['OFFSET', 'SIL', 'LWOP'];

/**
 * Whether the viewer may withdraw this Calendar entry: their own, approved,
 * Offset / SIL / LWOP, whose application's first Manila date has not passed.
 * Same rule as the server (ADR 0015, #613): `first_date < manila_today()`
 * refuses, so the start day itself is still withdrawable. A multi-day
 * application is one group, so the first day of the group decides, not the day
 * clicked. `entries` supplies the group's other days.
 */
export function canWithdrawEntry(entry, entries, viewerId, today = manilaToday()) {
  if (!entry || !viewerId) return false;
  if (!WITHDRAWABLE_KINDS.includes(entry.kind)) return false;
  if (entry.status !== 'APPROVED' || entry.employee?.id !== viewerId) return false;
  const days = (entries ?? [])
    .filter((e) => e.group_id && e.group_id === entry.group_id && e.kind === entry.kind)
    .map((e) => String(e.manila_date).slice(0, 10));
  days.push(String(entry.manila_date).slice(0, 10));
  const first = days.sort()[0];
  return Boolean(first) && first >= today;
}
