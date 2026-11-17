import { describe, expect, it } from 'vitest';
import { NO_PEOPLE, departmentsOf, filterByPeople, peopleOptions, selectedIds } from './peopleFilter.js';

const person = (id, department = 'SALES') => ({ id, name: id.toUpperCase(), department });
const leave = (id, who) => ({ kind: 'SIL', id, employee: who });
const activity = (id, filer, lead, others = []) => ({
  kind: 'MEETING',
  id,
  employee: filer,
  details: { facilitator: lead, participants: others },
});

const entries = [
  leave('l1', person('a')),
  leave('l2', person('b', 'IT')),
  activity('m1', person('c'), person('d', 'IT'), [person('e')]),
];

describe('people filter', () => {
  it('shows everything when nothing is chosen', () => {
    expect(selectedIds(NO_PEOPLE, peopleOptions(entries), 'a')).toBeNull();
    expect(filterByPeople(entries, null)).toBe(entries);
  });

  it('Only me keeps the viewer own Time Off and Activities', () => {
    const ids = selectedIds({ ...NO_PEOPLE, onlyMe: true }, peopleOptions(entries), 'e');
    expect(filterByPeople(entries, ids).map((e) => e.id)).toEqual(['m1']);
  });

  it('an Activity shows for its filer, Lead or a Participant', () => {
    for (const id of ['c', 'd', 'e']) {
      const ids = selectedIds({ ...NO_PEOPLE, people: [id] }, [], 'x');
      expect(filterByPeople(entries, ids).map((e) => e.id)).toEqual(['m1']);
    }
  });

  it('a department stands for its people', () => {
    const options = peopleOptions(entries);
    expect(departmentsOf(options)).toEqual(['IT', 'SALES']);
    const ids = selectedIds({ ...NO_PEOPLE, departments: ['IT'] }, options, 'x');
    expect(filterByPeople(entries, ids).map((e) => e.id)).toEqual(['l2', 'm1']);
  });
});
