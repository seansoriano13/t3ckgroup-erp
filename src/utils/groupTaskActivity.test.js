import { describe, it, expect } from 'vitest';
import { DEFAULT_ACTIVITY_SETTINGS } from './activitySettings';
import { calendarButtonState, dayToOpen, groupTaskDays } from './groupTaskActivity';
import { fileableActivityTypes, formTypeOptions } from './activityFiling';

const rules = DEFAULT_ACTIVITY_SETTINGS.general;
const now = new Date('2031-03-10T08:00:00+08:00');

describe('groupTaskDays', () => {
  it('runs from the Start Date to the Due Date', () => {
    expect(groupTaskDays({ startDate: '2031-03-20', dueDate: '2031-03-25' }, rules, now)).toEqual({ date: '2031-03-20', dateTo: '2031-03-25' });
  });
  it('starts today when the Start Date has passed or is blank', () => {
    expect(groupTaskDays({ startDate: '2031-03-01', dueDate: '2031-03-12' }, rules, now).date).toBe('2031-03-10');
    expect(groupTaskDays({ startDate: '', dueDate: '2031-03-12' }, rules, now)).toEqual({ date: '2031-03-10', dateTo: '2031-03-12' });
  });
  it('gives today only when the Due Date has passed', () => {
    expect(groupTaskDays({ startDate: '2031-03-01', dueDate: '2031-03-05' }, rules, now)).toEqual({ date: '2031-03-10', dateTo: '' });
  });
  it('stops at the one-year limit', () => {
    expect(groupTaskDays({ startDate: '', dueDate: '2035-01-01' }, rules, now).dateTo).toBe('2032-03-10');
  });
});

describe('groupTaskDays past the limit', () => {
  it('caps the first day too when the Start Date is beyond one year', () => {
    expect(groupTaskDays({ startDate: '2035-01-01', dueDate: '2035-02-01' }, rules, now)).toEqual({ date: '2032-03-10', dateTo: '' });
  });
});

describe('dayToOpen', () => {
  const days = [
    { id: 'a', starts_at: '2031-03-10T01:00:00Z', ends_at: '2031-03-10T02:00:00Z' },
    { id: 'b', starts_at: '2031-03-12T01:00:00Z', ends_at: '2031-03-12T02:00:00Z' },
  ];
  it('opens the next day that has not ended', () => expect(dayToOpen(days, new Date('2031-03-11T00:00:00Z'))).toBe('b'));
  it('opens the last day when all have passed', () => expect(dayToOpen(days, new Date('2031-04-01T00:00:00Z'))).toBe('b'));
});

describe('calendarButtonState', () => {
  it('adds when none is live, the type is on and the task is not cancelled', () =>
    expect(calendarButtonState({ liveActivity: null, typeOn: true, taskStatus: 'ACTIVE' })).toBe('add'));
  it('opens when one is live, even with the type off', () =>
    expect(calendarButtonState({ liveActivity: { id: 1 }, typeOn: false, taskStatus: 'CANCELLED' })).toBe('open'));
  it('shows nothing when the type is off or the task is cancelled', () => {
    expect(calendarButtonState({ liveActivity: null, typeOn: false, taskStatus: 'ACTIVE' })).toBeNull();
    expect(calendarButtonState({ liveActivity: null, typeOn: true, taskStatus: 'CANCELLED' })).toBeNull();
  });
});

describe('the ordinary form', () => {
  const user = { id: 'u', is_head: true };
  it('never offers Group Task', () => {
    expect(formTypeOptions(user)).not.toContain('GROUP_TASK');
    expect(fileableActivityTypes(user)).not.toContain('GROUP_TASK');
  });
  it('keeps it when editing a Group Task Activity', () => expect(formTypeOptions(user, 'GROUP_TASK')).toContain('GROUP_TASK'));
});
