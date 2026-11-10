import { describe, expect, it } from 'vitest';
import { initials, shortName, time12, withSpan } from './entrySpan.js';

const day = (id, date, over = {}) => ({ kind: 'SIL', id: `${id}-${date}`, group_id: id, manila_date: date, hours: 8, ...over });

describe('withSpan', () => {
  it('attaches the whole request to a multi-day Time Off entry', () => {
    const rows = [day('g', '2026-10-21'), day('g', '2026-10-19'), day('g', '2026-10-20', { hours: 4 }), day('h', '2026-10-19')];
    expect(withSpan(rows[0], rows).span).toEqual({ first: '2026-10-19', last: '2026-10-21', days: 3, hours: 20 });
  });

  it('leaves meetings, overtime and ungrouped entries alone', () => {
    const meeting = { kind: 'MEETING', id: 'm', group_id: null, manila_date: '2026-10-19' };
    const overtime = day('o', '2026-10-19', { kind: 'OVERTIME' });
    expect(withSpan(meeting, [meeting])).toBe(meeting);
    expect(withSpan(overtime, [overtime])).toBe(overtime);
    expect(withSpan(day('x', '2026-10-19', { group_id: null }), [])).not.toHaveProperty('span');
  });
});

describe('name and time helpers', () => {
  it('shortens names and times', () => {
    expect(initials('Ana Maria Cruz')).toBe('AM');
    expect(shortName('Andrea Villanueva')).toBe('Andrea V.');
    expect(shortName('Cher')).toBe('Cher');
    expect(time12('2026-10-19T01:00:00Z')).toBe('9a');
    expect(time12('2026-10-19T05:30:00Z')).toBe('1:30p');
  });
});
