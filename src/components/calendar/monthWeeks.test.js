import { describe, expect, it } from 'vitest';
import { monthRange, monthWeeks } from './monthWeeks.js';

describe('monthWeeks (Monday-first, Manila dates)', () => {
  it('starts every week on a Monday and ends it on a Sunday', () => {
    const weeks = monthWeeks('2026-10-15');
    for (const week of weeks) {
      expect(week).toHaveLength(7);
      expect(week[0].date.getDay()).toBe(1);
      expect(week[6].date.getDay()).toBe(0);
    }
  });

  it('pulls in six days before a month that starts on a Sunday', () => {
    // 1 Feb 2026 is a Sunday.
    const weeks = monthWeeks('2026-02-10');
    expect(weeks[0][0].ymd).toBe('2026-01-26');
    expect(weeks[0][6].ymd).toBe('2026-02-01');
    expect(weeks[0].filter((d) => d.inMonth).map((d) => d.ymd)).toEqual(['2026-02-01']);
    expect(weeks).toHaveLength(5);
  });

  it('spans six weeks when a 31-day month starts on a Sunday', () => {
    // 1 Mar 2026 is a Sunday and March has 31 days.
    const weeks = monthWeeks('2026-03-20');
    expect(weeks).toHaveLength(6);
    expect(weeks[0][0].ymd).toBe('2026-02-23');
    expect(weeks[5][6].ymd).toBe('2026-04-05');
  });

  it('gives the server the first and last day the grid shows', () => {
    expect(monthRange('2026-03-20')).toEqual({ from: '2026-02-23', to: '2026-04-05' });
  });
});
