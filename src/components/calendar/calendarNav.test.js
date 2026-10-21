import { describe, expect, it } from 'vitest';
import { parseCalendarParams, shiftDate, viewRange } from './calendarNav.js';

describe('calendarNav', () => {
  it('restores view and date from the URL, with safe fallbacks', () => {
    expect(parseCalendarParams(new URLSearchParams('view=week&date=2026-10-21'), '2026-01-01')).toEqual({
      view: 'week',
      date: '2026-10-21',
    });
    expect(parseCalendarParams(new URLSearchParams('view=nope&date=2026-02-31'), '2026-01-01')).toEqual({
      view: 'month',
      date: '2026-01-01',
    });
  });

  it('steps by the view unit', () => {
    expect(shiftDate('day', '2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDate('week', '2026-10-21', -1)).toBe('2026-10-14');
    expect(shiftDate('month', '2026-01-31', 1)).toBe('2026-02-28');
  });

  it('reads a Monday-to-Sunday range for the week', () => {
    expect(viewRange('week', '2026-10-21')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(viewRange('day', '2026-10-21')).toEqual({ from: '2026-10-21', to: '2026-10-21' });
  });
});
