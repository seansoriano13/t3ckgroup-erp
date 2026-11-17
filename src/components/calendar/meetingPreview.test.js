import { describe, it, expect } from 'vitest';
import { rangeWarnings } from './meetingPreview.js';

const me = { id: 'me', name: 'Me' };
const sil = (date) => ({ kind: 'SIL', id: `s-${date}`, status: 'APPROVED', manila_date: date, employee: me, details: {} });
const activity = (date, startsAt, endsAt) => ({
  kind: 'MEETING',
  id: `m-${date}`,
  manila_date: date,
  starts_at: startsAt,
  ends_at: endsAt,
  venue: null,
  details: { facilitator: me, participants: [] },
});

describe('rangeWarnings (#1056)', () => {
  // 2031-03-14 is a Friday.
  const fri = { date: '2031-03-14', start: '09:00', end: '10:00' };
  const sat = { date: '2031-03-15', start: '09:00', end: '10:00' };

  it('checks each day only against that day, and names the day when asked', () => {
    const entries = [sil('2031-03-15'), activity('2031-03-14', '2031-03-14T01:00:00.000Z', '2031-03-14T02:00:00.000Z')];
    expect(rangeWarnings(entries, { people: [me], days: [fri, sat], nameDays: true })).toEqual([
      'Fri, Mar 14: Me is in another Activity, 09:00 to 10:00.',
      'Sat, Mar 15: Me is on approved SIL that day.',
    ]);
  });

  it('reads as before for one day, and skips an Activity at another time that day', () => {
    const entries = [sil('2031-03-14'), activity('2031-03-14', '2031-03-14T03:00:00.000Z', '2031-03-14T04:00:00.000Z')];
    expect(rangeWarnings(entries, { people: [me], days: [fri] })).toEqual(['Me is on approved SIL that day.']);
  });

  it('says nothing about people not on the Activity, or days not listed', () => {
    expect(rangeWarnings([sil('2031-03-15')], { people: [{ id: 'other', name: 'Other' }], days: [sat] })).toEqual([]);
    expect(rangeWarnings([sil('2031-03-15')], { people: [me], days: [fri] })).toEqual([]);
  });
});
