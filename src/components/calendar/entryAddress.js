/**
 * The Calendar's open entry lives in the address as `?entry=<kind>:<id>`
 * (spec #1013, ticket #1016), e.g. `?entry=meeting:7c1e...`. The kind is the
 * server's `calendar_entries()` kind, written lowercase; an id may contain
 * colons, so only the first one splits.
 */
import { splitKindId } from '@/utils/recordLink.js';

export const ENTRY_PARAM = 'entry';

export function entryAddress(entry) {
  return `${String(entry.kind).toLowerCase()}:${entry.id}`;
}

/** { kind: 'MEETING', id } from an address, or null when it is missing or malformed. */
export function parseEntryAddress(value) {
  const parts = splitKindId(value);
  return parts && { kind: parts.kind.toUpperCase(), id: parts.id };
}

export const matchesAddress = (entry, parsed) =>
  Boolean(parsed) && String(entry.kind).toUpperCase() === parsed.kind && String(entry.id) === parsed.id;

/**
 * The entry an address opens. An exact id wins. A Meeting-kind address can also carry an Activity's
 * request id (old links, notifications): it opens that Activity's next day, or its first when all
 * have passed. Day 1 keeps the request id, so most links match exactly.
 */
export function findEntry(entries, parsed, now = new Date()) {
  if (!parsed) return null;
  const exact = entries.find((e) => matchesAddress(e, parsed));
  if (exact || parsed.kind !== 'MEETING') return exact ?? null;
  const days = entries
    .filter((e) => String(e.kind).toUpperCase() === 'MEETING' && String(e.group_id) === parsed.id)
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  return days.find((e) => new Date(e.ends_at) >= now) ?? days[0] ?? null;
}
