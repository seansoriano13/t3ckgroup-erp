import { describe, it, expect } from 'vitest';
import {
  parseTime,
  deriveHours,
  safeDeriveHours,
  formatTime,
  formatWindow,
  formatWindowCompact,
  compareByStartTime,
  windowsOverlap,
  isRequestInPendingPeriod,
  describeLeaveRange,
} from './time';

describe('time.js', () => {
  describe('parseTime', () => {
    it('parses valid time correctly', () => {
      expect(parseTime('00:00')).toBe(0);
      expect(parseTime('09:30')).toBe(570);
      expect(parseTime('14:45:00')).toBe(885);
    });

    it('returns null for invalid time', () => {
      expect(parseTime(null)).toBeNull();
      expect(parseTime('')).toBeNull();
      expect(parseTime('invalid')).toBeNull();
    });
  });

  describe('deriveHours', () => {
    it('derives correct hours for same day', () => {
      expect(deriveHours('09:00', '17:30')).toBe(8.5);
      expect(deriveHours('13:15', '14:45')).toBe(1.5);
    });

    it('throws error when end < start and allowOvernight is false', () => {
      expect(() => deriveHours('17:00', '02:00', false)).toThrow('End time must be after start time.');
    });

    it('derives correct hours when end < start and allowOvernight is true', () => {
      expect(deriveHours('17:00', '02:00', true)).toBe(9);
      expect(deriveHours('22:30', '06:00', true)).toBe(7.5);
    });
  });

  describe('formatWindowCompact', () => {
    it('drops the opening meridiem when both ends share it', () => {
      expect(formatWindowCompact('13:00', '16:00')).toBe('1–4PM');
      expect(formatWindowCompact('09:00', '11:00')).toBe('9–11AM');
    });

    it('keeps both meridiems when the window crosses noon or midnight', () => {
      expect(formatWindowCompact('09:00', '17:00')).toBe('9AM–5PM');
      expect(formatWindowCompact('22:00', '02:00')).toBe('10PM–2AM');
    });

    it('shows minutes only where there are any', () => {
      expect(formatWindowCompact('09:30', '13:00')).toBe('9:30AM–1PM');
      expect(formatWindowCompact('13:15', '14:45')).toBe('1:15–2:45PM');
    });

    it('reads midnight and noon as 12', () => {
      expect(formatWindowCompact('00:00', '12:00')).toBe('12AM–12PM');
    });

    it('says nothing for an absent window', () => {
      expect(formatWindowCompact(null, '17:00')).toBe('');
      expect(formatWindowCompact('', '')).toBe('');
    });
  });

  describe('compareByStartTime', () => {
    const at = (start_time) => ({ start_time })

    it('orders a day chronologically', () => {
      const day = [at('13:00'), at('08:00'), at('10:30')]
      expect(day.sort(compareByStartTime).map((l) => l.start_time)).toEqual([
        '08:00',
        '10:30',
        '13:00',
      ])
    })

    it('sorts rows with no window last', () => {
      // Leaves filed before the window columns existed have no place in a day.
      const day = [at(null), at('09:00'), at(undefined)]
      expect(day.sort(compareByStartTime).map((l) => l.start_time)).toEqual([
        '09:00',
        null,
        undefined,
      ])
    })
  });

  describe('safeDeriveHours', () => {
    it('derives the same hours as deriveHours for a valid window', () => {
      expect(safeDeriveHours('09:00', '17:30')).toBe(8.5);
      expect(safeDeriveHours('17:00', '02:00', true)).toBe(9);
    });

    it('reports nothing rather than throwing for a backwards window', () => {
      // A form calls this on every keystroke, including the moment an end time
      // sits before a start time the user has not corrected yet.
      expect(safeDeriveHours('17:00', '02:00', false)).toBe(0);
    });

    it('reports nothing for a half-finished window', () => {
      expect(safeDeriveHours('09:00', '')).toBe(0);
      expect(safeDeriveHours('', '')).toBe(0);
    });
  });

  describe('formatTime', () => {
    it('formats 24h to 12h AM/PM', () => {
      expect(formatTime('00:00')).toBe('12:00 AM');
      expect(formatTime('09:30')).toBe('9:30 AM');
      expect(formatTime('12:00')).toBe('12:00 PM');
      expect(formatTime('14:45')).toBe('2:45 PM');
      expect(formatTime('23:59')).toBe('11:59 PM');
    });
  });

  describe('formatWindow', () => {
    it('formats a window correctly', () => {
      expect(formatWindow('09:00', '17:30')).toBe('9:00 AM - 5:30 PM');
    });

    it('returns empty string if start or end is missing', () => {
      expect(formatWindow('09:00', null)).toBe('');
      expect(formatWindow(null, '17:30')).toBe('');
    });
  });

  describe('windowsOverlap', () => {
    it('returns false for non-overlapping windows', () => {
      expect(windowsOverlap({start: '09:00', end: '12:00'}, {start: '13:00', end: '17:00'})).toBe(false);
      expect(windowsOverlap({start: '13:00', end: '17:00'}, {start: '09:00', end: '12:00'})).toBe(false);
    });

    it('returns false for touching windows', () => {
      expect(windowsOverlap({start: '09:00', end: '13:00'}, {start: '13:00', end: '17:00'})).toBe(false);
    });

    it('returns true for overlapping windows', () => {
      expect(windowsOverlap({start: '09:00', end: '14:00'}, {start: '13:00', end: '17:00'})).toBe(true);
      expect(windowsOverlap({start: '13:00', end: '17:00'}, {start: '09:00', end: '14:00'})).toBe(true);
      expect(windowsOverlap({start: '09:00', end: '17:00'}, {start: '10:00', end: '12:00'})).toBe(true);
    });

    it('handles overnight overlaps correctly', () => {
      // 10 PM to 6 AM and 11 PM to 2 AM (overlap from 11 PM to 2 AM)
      expect(windowsOverlap({start: '22:00', end: '06:00'}, {start: '23:00', end: '02:00'})).toBe(true);
      // 10 PM to 6 AM and 4 AM to 12 PM (no overlap if on the same date, 4 AM is 18 hours before 10 PM)
      expect(windowsOverlap({start: '22:00', end: '06:00'}, {start: '04:00', end: '12:00'})).toBe(false);
    });
  });

  describe('isRequestInPendingPeriod', () => {
    it('returns true for ALL', () => {
      expect(isRequestInPendingPeriod(new Date(), 'ALL')).toBe(true);
    });

    it('filters OVERDUE correctly', () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      expect(isRequestInPendingPeriod(yesterday, 'OVERDUE')).toBe(true);
      expect(isRequestInPendingPeriod(today, 'OVERDUE')).toBe(false);
      expect(isRequestInPendingPeriod(tomorrow, 'OVERDUE')).toBe(false);
    });

    it('filters THIS_MONTH correctly', () => {
      const today = new Date();
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15);
      const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 15);

      expect(isRequestInPendingPeriod(today, 'THIS_MONTH')).toBe(true);
      expect(isRequestInPendingPeriod(nextMonth, 'THIS_MONTH')).toBe(false);
      expect(isRequestInPendingPeriod(prevMonth, 'THIS_MONTH')).toBe(false);
    });

    it('filters NEXT_MONTH correctly', () => {
      const today = new Date();
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15);
      const twoMonths = new Date(today.getFullYear(), today.getMonth() + 2, 15);
      
      expect(isRequestInPendingPeriod(today, 'NEXT_MONTH')).toBe(false);
      expect(isRequestInPendingPeriod(nextMonth, 'NEXT_MONTH')).toBe(true);
      expect(isRequestInPendingPeriod(twoMonths, 'NEXT_MONTH')).toBe(false);
    });
  });

  describe('describeLeaveRange', () => {
    it('reads a group of one as its single date', () => {
      expect(describeLeaveRange(['2026-03-10'])).toBe('2026-03-10');
    });

    it('reads a range as its span', () => {
      expect(describeLeaveRange(['2026-03-10', '2026-03-11', '2026-03-12'])).toBe(
        '2026-03-10 to 2026-03-12',
      );
    });

    it('adds the day count where the message is about the decision', () => {
      expect(describeLeaveRange(['2026-03-10', '2026-03-12'], { withDayCount: true })).toBe(
        '2026-03-10 to 2026-03-12 (2 days)',
      );
    });

    it('leaves the day count off a group of one, which would only ever say "1 day"', () => {
      expect(describeLeaveRange(['2026-03-10'], { withDayCount: true })).toBe('2026-03-10');
    });

    it('has nothing to say about a group with no dates', () => {
      expect(describeLeaveRange([])).toBeUndefined();
      expect(describeLeaveRange(null)).toBeUndefined();
    });
  });
});
