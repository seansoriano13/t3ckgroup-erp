import { describe, it, expect } from 'vitest';
import { getOvertimeOutcome, getOvertimeHoursDisplay } from './layout';

describe('TG-12 Overtime Presentation Logic', () => {
  describe('getOvertimeOutcome', () => {
    it('returns PAID OVERTIME for APPROVED_PAID', () => {
      expect(getOvertimeOutcome('APPROVED_PAID')).toBe('PAID OVERTIME');
    });

    it('returns OFFSET CREDIT for APPROVED_OFFSET', () => {
      expect(getOvertimeOutcome('APPROVED_OFFSET')).toBe('OFFSET CREDIT');
    });

    it('returns REJECTED for REJECTED', () => {
      expect(getOvertimeOutcome('REJECTED')).toBe('REJECTED');
    });

    it('returns PENDING for anything else', () => {
      expect(getOvertimeOutcome('PENDING')).toBe('PENDING');
      expect(getOvertimeOutcome('UNKNOWN')).toBe('PENDING');
    });
  });

  describe('getOvertimeHoursDisplay', () => {
    it('returns requested and approved as same when approved_hours is undefined', () => {
      const display = getOvertimeHoursDisplay({ hours: 4 });
      expect(display.requested).toBe(4);
      expect(display.approved).toBe(4);
      expect(display.isDifferent).toBe(false);
    });

    it('marks isDifferent true when approved_hours differ from requested_hours', () => {
      const display = getOvertimeHoursDisplay({ hours: 4, approved_hours: 2 });
      expect(display.requested).toBe(4);
      expect(display.approved).toBe(2);
      expect(display.isDifferent).toBe(true);
    });

    it('handles requested_hours alias', () => {
      const display = getOvertimeHoursDisplay({ requested_hours: 5, approved_hours: 3 });
      expect(display.requested).toBe(5);
      expect(display.approved).toBe(3);
      expect(display.isDifferent).toBe(true);
    });

    it('treats a null approved_hours (rejected/legacy) as no override, not a strike-through target', () => {
      const display = getOvertimeHoursDisplay({ hours: 4, approved_hours: null });
      expect(display.requested).toBe(4);
      expect(display.approved).toBe(4);
      expect(display.isDifferent).toBe(false);
    });
  });
});
