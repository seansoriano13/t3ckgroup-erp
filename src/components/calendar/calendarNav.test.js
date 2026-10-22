import { describe, expect, it } from 'vitest';
import { ganttDays, layoutRange, layoutTitle, parseCalendarParams, shiftDate } from './calendarNav.js';

describe('calendarNav', () => {
  it('restores layout, date and weeks from the URL, with safe fallbacks', () => {
    expect(parseCalendarParams(new URLSearchParams('layout=gantt&date=2026-10-21&weeks=4'), '2026-01-01')).toEqual({
      layout: 'gantt',
      date: '2026-10-21',
      weeks: 4,
    });
    expect(parseCalendarParams(new URLSearchParams('layout=nope&date=2026-02-31&weeks=3'), '2026-01-01')).toEqual({
      layout: 'calendar',
      date: '2026-01-01',
      weeks: 2,
    });
  });

  it('uses the remembered layout only when the URL has none', () => {
    expect(parseCalendarParams(new URLSearchParams(''), '2026-01-01', 'gantt').layout).toBe('gantt');
    expect(parseCalendarParams(new URLSearchParams('layout=calendar'), '2026-01-01', 'gantt').layout).toBe('calendar');
    expect(parseCalendarParams(new URLSearchParams(''), '2026-01-01', 'junk').layout).toBe('calendar');
  });

  it('steps a month on the Calendar and a week on the Gantt', () => {
    expect(shiftDate('calendar', '2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftDate('gantt', '2026-10-21', -1)).toBe('2026-10-14');
  });

  it('starts the Gantt on the Monday of the selected week, with weekends marked', () => {
    const days = ganttDays('2026-10-21', 2);
    expect(days).toHaveLength(14);
    expect(days[0].ymd).toBe('2026-10-19');
    expect(days.filter((d) => d.weekend).map((d) => d.ymd)).toEqual(['2026-10-24', '2026-10-25', '2026-10-31', '2026-11-01']);
    expect(layoutRange('gantt', '2026-10-21', 4)).toEqual({ from: '2026-10-19', to: '2026-11-15' });
    expect(layoutTitle('gantt', '2026-10-21', 2)).toBe('Oct 19 to Nov 1, 2026');
  });

  it('reads the whole month grid on the Calendar', () => {
    expect(layoutRange('calendar', '2026-10-21')).toEqual({ from: '2026-09-28', to: '2026-11-01' });
    expect(layoutTitle('calendar', '2026-10-21')).toBe('October 2026');
  });
});
