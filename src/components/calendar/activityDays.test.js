import { describe, it, expect } from 'vitest';
import { daysFromSaved, daysPayload, keptDays, rangeDays } from './activityDays.js';
import { draftProblem } from './meetingDraft.js';
import { activityWhen, lastDayStart, requestDays } from '@/services/meetingRequestService';

describe('Activity range days (#1056)', () => {
  it('lists every date in the range, a weekend included', () => {
    // 2031-03-14 is a Friday
    expect(rangeDays('2031-03-14', '2031-03-17').map((d) => d.date)).toEqual(['2031-03-14', '2031-03-15', '2031-03-16', '2031-03-17']);
  });

  it('keeps the form times unless a day has its own, and drops a removed day', () => {
    const days = keptDays('2031-03-14', '2031-03-16', { '2031-03-15': { start: '08:00', end: '12:00' }, '2031-03-16': null }, '09:00', '10:00');
    expect(days).toEqual([
      { date: '2031-03-14', start: '09:00', end: '10:00', frozen: false },
      { date: '2031-03-15', start: '08:00', end: '12:00', frozen: false },
    ]);
  });

  it('turns days into Manila instants for the service', () => {
    expect(daysPayload([{ date: '2031-03-15', start: '08:00', end: '12:00' }])).toEqual([
      { startsAt: '2031-03-15T00:00:00.000Z', endsAt: '2031-03-15T04:00:00.000Z' },
    ]);
  });

  it('reads a saved request back, marking started days and removed gaps', () => {
    const saved = [
      { starts_at: '2031-03-14T01:00:00.000Z', ends_at: '2031-03-14T02:00:00.000Z' },
      { starts_at: '2031-03-16T01:00:00.000Z', ends_at: '2031-03-16T03:00:00.000Z' },
    ];
    const form = daysFromSaved(saved, new Date('2031-03-14T05:00:00.000Z'));
    expect(form).toMatchObject({ from: '2031-03-14', to: '2031-03-16', start: '09:00', end: '10:00' });
    expect([...form.frozen]).toEqual(['2031-03-14']);
    expect(form.edits).toEqual({
      '2031-03-14': { start: '09:00', end: '10:00' },
      '2031-03-15': null,
      '2031-03-16': { start: '09:00', end: '11:00' },
    });
  });

  it('checks every day of a range, naming the bad one', () => {
    const base = { activityType: 'OPERATIONS_TASK', date: '2099-01-02', start: '09:00', end: '10:00', facilitatorId: 'f', purpose: 'Count' };
    const ok = [{ date: '2099-01-02', start: '09:00', end: '10:00' }, { date: '2099-01-03', start: '09:00', end: '12:00' }];
    expect(draftProblem({ ...base, days: ok })).toBeNull();
    expect(draftProblem({ ...base, days: [] })).toBe('Keep at least one day.');
    expect(draftProblem({ ...base, days: [ok[0], { date: '2099-01-03', start: '12:00', end: '09:00' }] })).toBe('2099-01-03: the Activity must end after it starts.');
    expect(draftProblem({ ...base, activityType: 'MEETING', venueId: 'v', days: ok })).toBe('A Meeting is one day.');
  });

  it('does not call a started day "in the past" when editing', () => {
    const base = { activityType: 'EVENT', date: '2020-01-02', start: '09:00', end: '10:00', facilitatorId: 'f', purpose: 'Fair' };
    expect(draftProblem({ ...base, days: [{ date: '2020-01-02', start: '09:00', end: '10:00', frozen: true }] })).toBeNull();
    expect(draftProblem({ ...base, days: [{ date: '2020-01-02', start: '09:00', end: '10:00', frozen: false }] })).toBe('2020-01-02: the Activity cannot start in the past.');
  });

  it('words a range as first day to last day, and finds the last start', () => {
    const request = {
      starts_at: '2031-03-14T01:00:00.000Z',
      ends_at: '2031-03-16T03:00:00.000Z',
      days: [
        { starts_at: '2031-03-16T01:00:00.000Z', ends_at: '2031-03-16T03:00:00.000Z' },
        { starts_at: '2031-03-14T01:00:00.000Z', ends_at: '2031-03-14T02:00:00.000Z' },
      ],
    };
    expect(requestDays(request).map((d) => d.starts_at)[0]).toBe('2031-03-14T01:00:00.000Z');
    expect(activityWhen(request)).toBe('Mar 14, 2031 · 9:00 AM to Mar 16, 2031 · 11:00 AM');
    expect(lastDayStart(request)).toBe('2031-03-16T01:00:00.000Z');
    expect(activityWhen({ starts_at: request.starts_at, ends_at: '2031-03-14T02:00:00.000Z' })).toBe('Mar 14, 2031 · 9:00 AM to 10:00');
  });
});
