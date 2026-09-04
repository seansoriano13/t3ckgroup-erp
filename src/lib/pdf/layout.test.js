import { describe, it, expect } from 'vitest';
import { resolveLeaveCategory, isLateFiling, getInclusiveDates, getDayCount, composeSheets, isLegacySignature, getBlankHalfRecord } from './layout';

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

  describe('getBlankHalfRecord', () => {
    it('returns a dummy record carrying only the type', () => {
      expect(getBlankHalfRecord('OVERTIME')).toEqual({ type: 'OVERTIME' });
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

  describe('composeSheets', () => {
    it('chunks correctly up to 2 per sheet and never mixes types', () => {
      const records = [
        { id: 1, type: 'OFFSET' },
        { id: 2, type: 'OFFSET' },
        { id: 3, type: 'OVERTIME' },
        { id: 4, type: 'OFFSET' }
      ];

      const sheets = composeSheets(records);
      expect(sheets.length).toBe(3);
      
      // Sheet 1: 2 OFFSETs
      expect(sheets[0]).toEqual([ { id: 1, type: 'OFFSET' }, { id: 2, type: 'OFFSET' } ]);
      
      // Sheet 2: 1 OFFSET (the third one, odd out)
      expect(sheets[1]).toEqual([ { id: 4, type: 'OFFSET' } ]);
      
      // Sheet 3: 1 OVERTIME
      expect(sheets[2]).toEqual([ { id: 3, type: 'OVERTIME' } ]);
    });

    it('handles any size of run', () => {
      const records = Array(5).fill({ type: 'SIL' });
      const sheets = composeSheets(records);
      expect(sheets.length).toBe(3);
      expect(sheets[0].length).toBe(2);
      expect(sheets[1].length).toBe(2);
      expect(sheets[2].length).toBe(1);
    });
  });
});
