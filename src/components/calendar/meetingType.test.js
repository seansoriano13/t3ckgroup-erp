import { describe, it, expect } from 'vitest';
import { draftProblem } from './meetingDraft.js';
import { findClash } from './meetingPreview.js';
import { guestList, guestText, meetingPlace, needsLink, needsVenue, safeLink } from '@/services/meetingRequestService';

const base = { date: '2099-01-02', start: '09:00', end: '10:00', facilitatorId: 'f', purpose: 'Sync' };

describe('meeting type rules in the form', () => {
  it('Onsite needs a Venue, Online needs a link, Hybrid needs both', () => {
    expect(draftProblem({ ...base, meetingType: 'ONSITE', venueId: '' })).toBe('Choose a Venue.');
    expect(draftProblem({ ...base, meetingType: 'ONSITE', venueId: 'v' })).toBeNull();
    expect(draftProblem({ ...base, meetingType: 'ONLINE', venueId: '', meetingLink: '' })).toBe('Paste the meeting link.');
    expect(draftProblem({ ...base, meetingType: 'ONLINE', venueId: '', meetingLink: 'https://x.test' })).toBeNull();
    expect(draftProblem({ ...base, meetingType: 'HYBRID', venueId: 'v', meetingLink: '' })).toBe('Paste the meeting link.');
    expect(draftProblem({ ...base, meetingType: 'HYBRID', venueId: '', meetingLink: 'https://x.test' })).toBe('Choose a Venue.');
  });

  it('flags a Guest email that is not an email', () => {
    expect(draftProblem({ ...base, venueId: 'v', guests: [{ name: 'Ana', email: 'nope' }] })).toBe('Check the email for Ana.');
    expect(draftProblem({ ...base, venueId: 'v', guests: [{ name: 'Ana', email: 'a@b.co' }, { name: 'Ben', email: '' }] })).toBeNull();
  });

  it('an Online meeting holds no Venue, so it never shows as a clash', () => {
    const online = { kind: 'MEETING', venue: null, starts_at: '2099-01-02T01:00:00Z', ends_at: '2099-01-02T02:00:00Z' };
    expect(findClash([online], 'Conference Room', online.starts_at, online.ends_at)).toBeNull();
  });
});

describe('meeting helpers', () => {
  it('knows which types need a Venue or a link', () => {
    expect([needsVenue('ONSITE'), needsVenue('ONLINE'), needsVenue('HYBRID')]).toEqual([true, false, true]);
    expect([needsLink('ONSITE'), needsLink('ONLINE'), needsLink('HYBRID')]).toEqual([false, true, true]);
  });

  it('pairs Guest names with emails', () => {
    const list = guestList(['Ana', 'Ben'], ['ana@x.co', '']);
    expect(list).toEqual([{ name: 'Ana', email: 'ana@x.co' }, { name: 'Ben', email: '' }]);
    expect(list.map(guestText)).toEqual(['Ana <ana@x.co>', 'Ben']);
    expect(guestList(['Old'], undefined)).toEqual([{ name: 'Old', email: '' }]);
  });

  it('only makes web links clickable', () => {
    expect(safeLink(' https://meet.example.com/a ')).toBe('https://meet.example.com/a');
    expect(safeLink('javascript:alert(1)')).toBeNull();
  });

  it('names the place', () => {
    expect(meetingPlace({ meeting_type: 'ONLINE' })).toBe('Online');
    expect(meetingPlace({ meeting_type: 'HYBRID', venue: { name: 'Admin Office' } })).toBe('Admin Office + Online');
    expect(meetingPlace({ meeting_type: 'ONSITE', venue: { name: 'Admin Office' } })).toBe('Admin Office');
  });
});
