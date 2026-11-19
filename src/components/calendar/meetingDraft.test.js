import { describe, it, expect } from 'vitest';
import { defaultSlot, draftProblem, draftProblems, latestDate } from './meetingDraft.js';
import { DEFAULT_ACTIVITY_SETTINGS } from '@/utils/activitySettings';

const rules = DEFAULT_ACTIVITY_SETTINGS.general;
const manila = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+08:00`);
// The clock for the form tests: a fixed day, so "one year ahead" does not move with the real calendar.
const NOW = manila('2031-01-01', '08:00');
const problemsAt = (d, now = NOW) => draftProblems(d, now);
const problemAt1 = (d, now = NOW) => draftProblem(d, now);

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
  const draft = { activityType: 'ADMIN_TASK', multiDay: true, date: '2031-01-02', start: '09:00', end: '10:00', facilitatorId: 'f', purpose: 'Sync' };
  const day = (date, over = {}) => ({ date, start: '09:00', end: '10:00', frozen: false, ...over });

  it('lists each problem with the box it belongs under, in reading order', () => {
    expect(problemsAt({ ...draft, activityType: 'MEETING', meetingType: 'HYBRID', venueId: '', meetingLink: '', facilitatorId: '', purpose: ' ' })).toEqual([
      { field: 'venue', message: 'Choose a Venue.' },
      { field: 'link', message: 'Paste the meeting link.' },
      { field: 'lead', message: 'Choose a Lead.' },
      { field: 'purpose', message: 'Write the purpose of the Activity.' },
    ]);
  });

  it('is empty for a draft that can be filed, and draftProblem is then null', () => {
    expect(problemsAt(draft)).toEqual([]);
    expect(problemAt1(draft)).toBeNull();
  });

  it('draftProblem is the first of the list', () => {
    expect(problemAt1({ ...draft, facilitatorId: '', purpose: '' })).toBe('Choose a Lead.');
  });

  it('puts a start in the past under the time boxes', () => {
    const now = manila('2031-01-02', '14:00');
    expect(problemsAt({ ...draft, days: [day('2031-01-02')] }, now)).toEqual([{ field: 'time', message: '2031-01-02: the Activity cannot start in the past.' }]);
    expect(problemsAt({ ...draft, multiDay: false, activityType: 'MEETING', venueId: 'v' }, now)).toEqual([{ field: 'time', message: 'The Activity cannot start in the past.' }]);
  });

  it('puts a past day of a range under the days list', () => {
    const now = manila('2031-01-03', '08:00');
    expect(problemsAt({ ...draft, days: [day('2031-01-02'), day('2031-01-03')] }, now)).toEqual([{ field: 'days', message: '2031-01-02: the Activity cannot start in the past.' }]);
  });

  it('says "To cannot be before From." under To, and not "Keep at least one day." for it', () => {
    // From the 5th, To the 3rd, and the first day was removed: the days list is empty only because of the To.
    const backwards = { ...draft, date: '2031-01-05', dateTo: '2031-01-03', days: [] };
    expect(problemsAt(backwards)).toEqual([{ field: 'dateTo', message: 'To cannot be before From.' }]);
    expect(problemAt1(backwards)).toBe('To cannot be before From.');
  });

  it('still says "Keep at least one day." when the person removed every day', () => {
    expect(problemsAt({ ...draft, dateTo: '2031-01-03', days: [] })).toEqual([{ field: 'days', message: 'Keep at least one day.' }]);
  });

  it('leaves a To that is empty, equal or later alone', () => {
    for (const dateTo of ['', '2031-01-02', '2031-01-04']) {
      expect(problemsAt({ ...draft, dateTo, days: [day('2031-01-02')] })).toEqual([]);
    }
  });

  it('only checks To for a type that can run over several days', () => {
    expect(problemsAt({ ...draft, activityType: 'MEETING', multiDay: false, venueId: 'v', dateTo: '2000-01-01' })).toEqual([]);
  });

  it('puts the range limit under To and a one-day type with several days under the date', () => {
    expect(problemsAt({ ...draft, maxDays: 2, days: [day('2031-01-02'), day('2031-01-03'), day('2031-01-04')] })).toEqual([{ field: 'dateTo', message: 'An Activity can cover at most 2 days.' }]);
    expect(problemsAt({ ...draft, activityType: 'MEETING', multiDay: false, typeName: 'Meeting', venueId: 'v', days: [day('2031-01-02'), day('2031-01-03')] })).toEqual([{ field: 'date', message: 'A Meeting is one day.' }]);
  });

  it('puts a bad Guest email under Guests', () => {
    expect(problemsAt({ ...draft, guests: [{ name: 'Ana', email: 'nope' }] })).toEqual([{ field: 'guests', message: 'Check the email for Ana.' }]);
  });

  it('lets two Guests share a name when their emails differ', () => {
    expect(problemsAt({ ...draft, guests: [{ name: 'Ana', email: 'ana@a.co' }, { name: 'Ana', email: 'ana@b.co' }, { name: 'Ana', email: '' }] })).toEqual([]);
  });
});

describe('the limits on the form (#1087)', () => {
  const draft = { activityType: 'MEETING', meetingType: 'ONLINE', meetingLink: 'https://meet.google.com/x', date: '2031-01-02', start: '09:00', end: '10:00', facilitatorId: 'f', purpose: 'Sync' };
  const LINK_MESSAGE = 'The meeting link must start with http:// or https://.';

  it('accepts a web link, either scheme and any capitals', () => {
    for (const meetingLink of ['https://meet.google.com/x', 'http://intranet/room', ' HTTPS://Meet.Example/x ']) {
      expect(problemsAt({ ...draft, meetingLink })).toEqual([]);
    }
  });

  it('refuses a link that is not a web link, under the link box', () => {
    for (const meetingLink of ['javascript:alert(1)', 'not a url', 'meet.google.com/x', 'ftp://files/x', 'https://', 'mailto:a@b.co', 'https://meet.google.com/a b', 'https:// meet.google.com']) {
      expect(problemsAt({ ...draft, meetingLink })).toEqual([{ field: 'link', message: LINK_MESSAGE }]);
    }
    expect(problemAt1({ ...draft, meetingLink: 'javascript:alert(1)' })).toBe(LINK_MESSAGE);
  });

  it('still asks for a link when the box is empty, and ignores a stale link on an Onsite Meeting', () => {
    expect(problemsAt({ ...draft, meetingLink: '  ' })).toEqual([{ field: 'link', message: 'Paste the meeting link.' }]);
    expect(problemsAt({ ...draft, meetingType: 'ONSITE', venueId: 'v', meetingLink: 'not a url' })).toEqual([]);
  });

  it('checks the link of a Hybrid Meeting too', () => {
    expect(problemsAt({ ...draft, meetingType: 'HYBRID', venueId: 'v', meetingLink: 'nope' })).toEqual([{ field: 'link', message: LINK_MESSAGE }]);
  });

  it('allows a purpose of 500 characters and refuses 501, counting the trimmed text', () => {
    expect(problemsAt({ ...draft, purpose: 'a'.repeat(500) })).toEqual([]);
    expect(problemsAt({ ...draft, purpose: `  ${'a'.repeat(500)}  ` })).toEqual([]);
    expect(problemsAt({ ...draft, purpose: 'a'.repeat(501) })).toEqual([{ field: 'purpose', message: 'The purpose can be at most 500 characters.' }]);
  });

  it('counts a character outside the basic plane once, as the database does', () => {
    expect(problemsAt({ ...draft, purpose: '😀'.repeat(500) })).toEqual([]);
  });

  it('allows a date up to one year ahead (Manila) and refuses a day later, under the date', () => {
    const now = manila('2031-03-10', '14:00');
    expect(latestDate(now)).toBe('2032-03-10');
    expect(problemsAt({ ...draft, date: '2032-03-10' }, now)).toEqual([]);
    expect(problemsAt({ ...draft, date: '2032-03-11' }, now)).toEqual([{ field: 'date', message: 'The date can be at most one year ahead.' }]);
    expect(problemsAt({ ...draft, date: '2032-02-10' }, now)).toEqual([]);
    expect(problemsAt({ ...draft, date: '2032-04-10' }, now)).toEqual([{ field: 'date', message: 'The date can be at most one year ahead.' }]);
  });

  it('counts "today" in Manila, and falls back to 28 Feb from 29 Feb', () => {
    expect(latestDate(manila('2031-12-31', '23:30'))).toBe('2032-12-31');
    expect(latestDate(manila('2032-01-01', '00:30'))).toBe('2033-01-01');
    expect(latestDate(manila('2031-02-28', '10:00'))).toBe('2032-02-28');
    expect(latestDate(manila('2032-02-29', '10:00'))).toBe('2033-02-28');
  });

  it('puts a To beyond a year under To, for a type that runs over several days', () => {
    const now = manila('2031-03-10', '14:00');
    const range = { ...draft, activityType: 'ADMIN_TASK', multiDay: true, date: '2031-03-12', dateTo: '2032-03-11' };
    expect(problemsAt(range, now)).toEqual([{ field: 'dateTo', message: 'The date can be at most one year ahead.' }]);
    expect(problemsAt({ ...range, dateTo: '2032-03-10' }, now)).toEqual([]);
  });

  it('says To is before From when both dates are far ahead, after the date message', () => {
    const now = manila('2031-03-10', '14:00');
    const far = { ...draft, activityType: 'ADMIN_TASK', multiDay: true, date: '2033-01-05', dateTo: '2033-01-03' };
    expect(problemsAt(far, now).map((p) => p.message)).toEqual(['The date can be at most one year ahead.', 'To cannot be before From.']);
  });
});
