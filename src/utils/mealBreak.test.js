import { describe, expect, it } from 'vitest';
import { mealBreakHours, netHoursAfterMealBreak, DEFAULT_MEAL_WINDOWS } from './mealBreak';

describe('mealBreakHours', () => {
  it('1pm-6pm loses no hour', () => expect(mealBreakHours('13:00', '18:00')).toBe(0));
  it('10am-2pm loses one hour', () => expect(mealBreakHours('10:00', '14:00')).toBe(1));
  it('a window only partly over lunch loses nothing', () => expect(mealBreakHours('12:30', '16:00')).toBe(0));
  it('dinner counts only when switched on', () => {
    expect(mealBreakHours('17:00', '20:00')).toBe(0);
    const on = DEFAULT_MEAL_WINDOWS.map((m) => (m.key === 'dinner' ? { ...m, enabled: true } : m));
    expect(mealBreakHours('17:00', '20:00', on)).toBe(1);
  });
  it('takes off more than one meal', () => {
    const all = DEFAULT_MEAL_WINDOWS.map((m) => ({ ...m, enabled: true }));
    expect(mealBreakHours('05:00', '20:00', all)).toBe(3);
  });
});

describe('netHoursAfterMealBreak', () => {
  it('deducts the covered hour', () => expect(netHoursAfterMealBreak(4, '10:00', '14:00')).toBe(3));
  it('HR keep-in leaves the hour in', () => expect(netHoursAfterMealBreak(4, '10:00', '14:00', { keepIn: true })).toBe(4));
});
