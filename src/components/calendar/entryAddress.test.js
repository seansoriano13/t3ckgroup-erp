import { describe, expect, it } from 'vitest';
import { entryAddress, findEntry, matchesAddress, parseEntryAddress } from './entryAddress.js';

describe('entry address', () => {
  it('round-trips a kind and id', () => {
    const addr = entryAddress({ kind: 'MEETING', id: 'abc-1' });
    expect(addr).toBe('meeting:abc-1');
    expect(parseEntryAddress(addr)).toEqual({ kind: 'MEETING', id: 'abc-1' });
  });
  it('rejects malformed values', () => {
    for (const v of [null, '', 'meeting', 'meeting:', ':x']) expect(parseEntryAddress(v)).toBeNull();
  });
  it('matches by kind and id', () => {
    const p = parseEntryAddress('sil:9');
    expect(matchesAddress({ kind: 'SIL', id: 9 }, p)).toBe(true);
    expect(matchesAddress({ kind: 'LWOP', id: 9 }, p)).toBe(false);
  });

  describe('findEntry for an Activity with several days', () => {
    const day = (id, startsAt) => ({ kind: 'MEETING', id, group_id: 'req', starts_at: startsAt, ends_at: startsAt });
    const entries = [day('req', '2031-03-10T01:00:00.000Z'), day('d2', '2031-03-11T01:00:00.000Z'), day('d3', '2031-03-12T01:00:00.000Z')];
    it('opens the exact day when the address names a day', () => {
      expect(findEntry(entries, parseEntryAddress('meeting:d3'))?.id).toBe('d3');
    });
    it('opens day 1 for the request id', () => {
      expect(findEntry(entries, parseEntryAddress('meeting:req'), new Date('2031-03-01T00:00:00Z'))?.id).toBe('req');
    });
    it('opens the next upcoming day when the request id no longer matches a day', () => {
      const moved = entries.slice(1);
      expect(findEntry(moved, parseEntryAddress('meeting:req'), new Date('2031-03-11T05:00:00Z'))?.id).toBe('d3');
      expect(findEntry(moved, parseEntryAddress('meeting:req'), new Date('2031-04-01T00:00:00Z'))?.id).toBe('d2');
    });
    it('finds nothing for an unknown id', () => {
      expect(findEntry(entries, parseEntryAddress('meeting:nope'))).toBeNull();
      expect(findEntry(entries, null)).toBeNull();
    });
  });
});
