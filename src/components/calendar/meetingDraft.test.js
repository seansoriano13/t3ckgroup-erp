import { describe, it, expect } from 'vitest';
import { defaultSlot, draftProblem, draftProblems } from './meetingDraft.js';
import { DEFAULT_ACTIVITY_SETTINGS } from '@/utils/activitySettings';

const rules = DEFAULT_ACTIVITY_SETTINGS.general;
const manila = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+08:00`);

describe('defaultSlot', () => {
  it('keeps the default start while it is still ahead', () => {
    expect(defaultSlot(rules, manila('2031-03-10', '07:12'))).toEqual({ date: '2031-03-10', start: '09:00', end: '10:00' });
  });

  it('takes the next slot once the default start has passed, and keeps the default length', () => {
    expect(defaultSlot(rules, manila('2031-03-10', '14:00'))).toEqual({ date: '2031-03-10', start: '14:00', end: '15:00' });
    expect(defaultSlot(rules, manila('2031-03-10', '14:01'))).toEqual({ date: '2031-03-10', start: '14:15', end: '15:15' });
  });

  it('ends no later than the last time of the day', () => {
    expect(defaultSlot(rules, manila('2031-03-10', '21:20'))).toEqual({ date: '2031-03-10', start: '21:30', end: '21:45' });
  });

  it('goes to the default start tomorrow when no slot is left today', () => {
    expect(defaultSlot(rules, manila('2031-03-10', '21:50'))).toEqual({ date: '2031-03-11', start: '09:00', end: '10:00' });
    // Late in Manila is still "today" there while UTC has already moved on: the Manila date decides.
    expect(defaultSlot(rules, manila('2031-12-31', '23:30'))).toEqual({ date: '2032-01-01', start: '09:00', end: '10:00' });
  });

  it('follows the hours and step HR set', () => {
    const hourly = { ...rules, earliestStart: '08:00', latestEnd: '18:00', timeStep: 60, defaultStart: '09:00', defaultEnd: '10:00' };
    expect(defaultSlot(hourly, manila('2031-03-10', '13:10'))).toEqual({ date: '2031-03-10', start: '14:00', end: '15:00' });
  });

  it('keeps a later day the person picked, with the default start', () => {
    expect(defaultSlot(rules, manila('2031-03-10', '14:00'), '2031-03-12')).toEqual({ date: '2031-03-12', start: '09:00', end: '10:00' });
  });

  it('moves a picked day that is today forward like any other opening', () => {
    expect(defaultSlot(rules, manila('2031-03-10', '14:20'), '2031-03-10')).toEqual({ date: '2031-03-10', start: '14:30', end: '15:30' });
  });
});

describe('draftProblems', () => {
  const draft = { activityType: 'ADMIN_TASK', multiDay: true, date: '2099-01-02', start: '09:00', end: '10:00', facilitatorId: 'f', purpose: 'Sync' };
  const day = (date, over = {}) => ({ date, start: '09:00', end: '10:00', frozen: false, ...over });

  it('lists each problem with the box it belongs under, in reading order', () => {
    expect(draftProblems({ ...draft, activityType: 'MEETING', meetingType: 'HYBRID', venueId: '', meetingLink: '', facilitatorId: '', purpose: ' ' })).toEqual([
      { field: 'venue', message: 'Choose a Venue.' },
      { field: 'link', message: 'Paste the meeting link.' },
      { field: 'lead', message: 'Choose a Lead.' },
      { field: 'purpose', message: 'Write the purpose of the Activity.' },
    ]);
  });

  it('is empty for a draft that can be filed, and draftProblem is then null', () => {
    expect(draftProblems(draft)).toEqual([]);
    expect(draftProblem(draft)).toBeNull();
  });

  it('draftProblem is the first of the list', () => {
    expect(draftProblem({ ...draft, facilitatorId: '', purpose: '' })).toBe('Choose a Lead.');
  });

  it('puts a start in the past under the time boxes', () => {
    const now = manila('2099-01-02', '14:00');
    expect(draftProblems({ ...draft, days: [day('2099-01-02')] }, now)).toEqual([{ field: 'time', message: '2099-01-02: the Activity cannot start in the past.' }]);
    expect(draftProblems({ ...draft, multiDay: false, activityType: 'MEETING', venueId: 'v' }, now)).toEqual([{ field: 'time', message: 'The Activity cannot start in the past.' }]);
  });

  it('puts a past day of a range under the days list', () => {
    const now = manila('2099-01-03', '08:00');
    expect(draftProblems({ ...draft, days: [day('2099-01-02'), day('2099-01-03')] }, now)).toEqual([{ field: 'days', message: '2099-01-02: the Activity cannot start in the past.' }]);
  });

  it('says "To cannot be before From." under To, and not "Keep at least one day." for it', () => {
    // From the 5th, To the 3rd, and the first day was removed: the days list is empty only because of the To.
    const backwards = { ...draft, date: '2099-01-05', dateTo: '2099-01-03', days: [] };
    expect(draftProblems(backwards)).toEqual([{ field: 'dateTo', message: 'To cannot be before From.' }]);
    expect(draftProblem(backwards)).toBe('To cannot be before From.');
  });

  it('still says "Keep at least one day." when the person removed every day', () => {
    expect(draftProblems({ ...draft, dateTo: '2099-01-03', days: [] })).toEqual([{ field: 'days', message: 'Keep at least one day.' }]);
  });

  it('leaves a To that is empty, equal or later alone', () => {
    for (const dateTo of ['', '2099-01-02', '2099-01-04']) {
      expect(draftProblems({ ...draft, dateTo, days: [day('2099-01-02')] })).toEqual([]);
    }
  });

  it('only checks To for a type that can run over several days', () => {
    expect(draftProblems({ ...draft, activityType: 'MEETING', multiDay: false, venueId: 'v', dateTo: '2000-01-01' })).toEqual([]);
  });

  it('puts the range limit under To and a one-day type with several days under the date', () => {
    expect(draftProblems({ ...draft, maxDays: 2, days: [day('2099-01-02'), day('2099-01-03'), day('2099-01-04')] })).toEqual([{ field: 'dateTo', message: 'An Activity can cover at most 2 days.' }]);
    expect(draftProblems({ ...draft, activityType: 'MEETING', multiDay: false, typeName: 'Meeting', venueId: 'v', days: [day('2099-01-02'), day('2099-01-03')] })).toEqual([{ field: 'date', message: 'A Meeting is one day.' }]);
  });

  it('puts a bad Guest email under Guests', () => {
    expect(draftProblems({ ...draft, guests: [{ name: 'Ana', email: 'nope' }] })).toEqual([{ field: 'guests', message: 'Check the email for Ana.' }]);
  });
});
