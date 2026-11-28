import { describe, expect, it } from 'vitest';
import { fmtHours, hoursOf } from './leaveDisplay';

describe('fmtHours', () => {
  it('rounds float noise to at most 2 decimals', () => {
    expect(fmtHours(3.5999999999999996)).toBe(3.6);
    expect(fmtHours(1.23456)).toBe(1.23);
    expect(fmtHours(8)).toBe(8);
  });

  it('treats blank as zero', () => {
    expect(fmtHours(null)).toBe(0);
  });
});

describe('hoursOf', () => {
  it('shows filed undertime hours rounded (bug report: 3.5999999999999996 hrs)', () => {
    const h = hoursOf({ type: 'UNDERTIME', hours: 3.5999999999999996 });
    expect(h.requested).toBe(3.6);
    expect(h.granted).toBe(3.6);
    expect(h.changed).toBe(false);
  });

  it('rounds granted hours and still spots a real change', () => {
    const h = hoursOf({ type: 'OVERTIME', hours: 2.0000000001, approved_hours: 1.4999999999 });
    expect(h).toEqual({ requested: 2, granted: 1.5, changed: true });
  });
});
