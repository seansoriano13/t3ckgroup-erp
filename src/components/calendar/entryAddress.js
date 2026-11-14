/**
 * The Calendar's open entry lives in the address as `?entry=<kind>:<id>`
 * (spec #1013, ticket #1016), e.g. `?entry=meeting:7c1e...`. The kind is the
 * server's `calendar_entries()` kind, written lowercase; an id may contain
 * colons, so only the first one splits.
 */
export const ENTRY_PARAM = 'entry';

export function entryAddress(entry) {
  return `${String(entry.kind).toLowerCase()}:${entry.id}`;
}

/** { kind: 'MEETING', id } from an address, or null when it is missing or malformed. */
export function parseEntryAddress(value) {
  if (!value) return null;
  const at = value.indexOf(':');
  if (at < 1 || at === value.length - 1) return null;
  return { kind: value.slice(0, at).toUpperCase(), id: value.slice(at + 1) };
}

export const matchesAddress = (entry, parsed) =>
  Boolean(parsed) && String(entry.kind).toUpperCase() === parsed.kind && String(entry.id) === parsed.id;
