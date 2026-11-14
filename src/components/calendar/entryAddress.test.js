import { describe, expect, it } from 'vitest';
import { entryAddress, matchesAddress, parseEntryAddress } from './entryAddress.js';

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
});
