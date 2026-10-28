import { parseTime } from './time';

/**
 * Meal Break: one shared rule that takes off each meal hour a filed window
 * covers. Lunch is on by default; dinner and breakfast are HR-set and off
 * until HR switches them on (see meal_break_settings).
 */
export const DEFAULT_MEAL_WINDOWS = [
  { key: 'lunch', start: '12:00', end: '13:00', enabled: true },
  { key: 'breakfast', start: '06:00', end: '07:00', enabled: false },
  { key: 'dinner', start: '18:00', end: '19:00', enabled: false },
];

/** Meal windows switched on that the filed window fully covers. */
export function coveredMealWindows(startTime, endTime, meals = DEFAULT_MEAL_WINDOWS) {
  const s = parseTime(startTime);
  let e = parseTime(endTime);
  if (s === null || e === null) return [];
  if (e < s) e += 24 * 60; // overnight window
  return meals.filter((m) => {
    if (!m.enabled) return false;
    const ms = parseTime(m.start);
    const me = parseTime(m.end);
    if (ms === null || me === null) return false;
    return (s <= ms && e >= me) || (s <= ms + 1440 && e >= me + 1440);
  });
}

/** Hours to take off a window; 0 for each meal not covered or switched off. */
export function mealBreakHours(startTime, endTime, meals = DEFAULT_MEAL_WINDOWS) {
  return coveredMealWindows(startTime, endTime, meals).reduce(
    (sum, m) => sum + (parseTime(m.end) - parseTime(m.start)) / 60,
    0
  );
}

/**
 * Gross hours minus covered meal hours. `keepIn` (HR kept the hour in, with a
 * saved reason) skips the deduction.
 */
export function netHoursAfterMealBreak(grossHours, startTime, endTime, { meals = DEFAULT_MEAL_WINDOWS, keepIn = false } = {}) {
  if (keepIn) return grossHours;
  return Math.max(0, Number((grossHours - mealBreakHours(startTime, endTime, meals)).toFixed(2)));
}
