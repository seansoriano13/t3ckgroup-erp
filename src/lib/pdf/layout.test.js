import { describe, it, expect } from 'vitest';
import { resolveLeaveCategory, isLateFiling, getDayCount, pairIntoSheets, isLegacySignature, getOvertimeOutcome, getOvertimeHoursDisplay } from './layout';

describe('PDF Layout Logic', () => {
  describe('resolveLeaveCategory', () => {
    it('prefers the record\'s own joined category over any type-based guess', () => {
      expect(resolveLeaveCategory({ type: 'SIL', category: { label: 'Sick Leave' } })).toBe('Sick Leave');
    });

    it('falls back to Overtime for OVERTIME type with no category', () => {
      expect(resolveLeaveCategory({ type: 'OVERTIME' })).toBe('Overtime');
    });

    it('falls back to Offset for OFFSET type with no category', () => {
      expect(resolveLeaveCategory({ type: 'OFFSET' })).toBe('Offset');
    });

    it('falls back to Service Incentive Leave for SIL type with no category', () => {
      expect(resolveLeaveCategory({ type: 'SIL' })).toBe('Service Incentive Leave');
    });

    it('returns Unknown when neither a category nor a recognised type is present', () => {
      expect(resolveLeaveCategory({})).toBe('Unknown');
    });
  });

  describe('isLegacySignature', () => {
    it('is false for a digitally signed approved record', () => {
      expect(isLegacySignature({ status: 'APPROVED', employee_signature_timestamp: '2026-01-01T00:00:00Z' })).toBe(false);
    });

    it('is true for an approved record with no employee_signature_timestamp', () => {
      expect(isLegacySignature({ status: 'APPROVED' })).toBe(true);
    });

    it('is false for a non-approved record', () => {
      expect(isLegacySignature({ status: 'PENDING' })).toBe(false);
    });
  });

  describe('isLateFiling', () => {
    it('returns true if created_at is strictly after startDate', () => {
      expect(isLateFiling({ startDate: '2026-09-01', created_at: '2026-09-02T10:00:00Z' })).toBe(true);
    });

    it('returns false if created_at is on the same day as startDate', () => {
      expect(isLateFiling({ startDate: '2026-09-01', created_at: '2026-09-01T23:59:00Z' })).toBe(false);
    });

    it('returns false if created_at is before startDate', () => {
      expect(isLateFiling({ startDate: '2026-09-05', created_at: '2026-09-01T10:00:00Z' })).toBe(false);
    });
  });

  describe('getDayCount', () => {
    it('returns dayCount if available', () => {
      expect(getDayCount({ dayCount: 3 })).toBe(3);
    });

    it('calculates from dates', () => {
      expect(getDayCount({ startDate: '2026-09-01', endDate: '2026-09-03' })).toBe(3);
      expect(getDayCount({ startDate: '2026-09-01', endDate: '2026-09-01' })).toBe(1);
    });
  });

  describe('pairIntoSheets', () => {
    it('returns an empty list for an empty tray', () => {
      expect(pairIntoSheets([])).toEqual([]);
    });

    it('pairs a single record with a null bottom', () => {
      const record = { id: 1, type: 'OFFSET' };
      expect(pairIntoSheets([record])).toEqual([{ top: record, bottom: null }]);
    });

    it('pairs an even-count run two per sheet, in list order', () => {
      const records = [
        { id: 1, type: 'OFFSET' },
        { id: 2, type: 'OVERTIME' },
        { id: 3, type: 'SIL' },
        { id: 4, type: 'OFFSET' },
      ];
      expect(pairIntoSheets(records)).toEqual([
        { top: records[0], bottom: records[1] },
        { top: records[2], bottom: records[3] },
      ]);
    });

    it('leaves the last sheet half-filled for an odd-count run, regardless of type', () => {
      const records = [
        { id: 1, type: 'OFFSET' },
        { id: 2, type: 'OFFSET' },
        { id: 3, type: 'OVERTIME' },
      ];
      expect(pairIntoSheets(records)).toEqual([
        { top: records[0], bottom: records[1] },
        { top: records[2], bottom: null },
      ]);
    });

    it('pairs adjacent records regardless of type — order is the only input, never type-segregated', () => {
      const records = [
        { id: 1, type: 'OFFSET' },
        { id: 2, type: 'OVERTIME' },
      ];
      expect(pairIntoSheets(records)).toEqual([{ top: records[0], bottom: records[1] }]);
    });
  });

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
