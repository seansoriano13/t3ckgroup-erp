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
