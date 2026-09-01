import { describe, it, expect } from 'vitest';
import { parseTime, deriveHours, formatTime, formatWindow, windowsOverlap } from './time';

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
});
