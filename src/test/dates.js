/**
 * Dates a test needs to be relative to today rather than fixed.
 *
 * Most of the suite uses hard-coded dates on purpose — a leave on 2026-03-10
 * reads better than one computed at runtime, and nothing about it depends on
 * when the test runs. These helpers are for the cases where something does.
 */

/**
 * The next `count` weekdays, in UTC.
 *
 * Issue #111 refuses to withdraw an approved leave whose first date has
 * passed, so a withdrawal test that must succeed needs a leave that has not
 * been taken yet — which a hard-coded date stops being the moment the calendar
 * moves past it. Weekdays because the apply paths refuse a Saturday or Sunday
 * (`assertNotWeekend`), and UTC because that is what the guard compares
 * against.
 */
export function upcomingWeekdays(count) {
  const days = []
  const cursor = new Date()
  while (days.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) days.push(cursor.toISOString().slice(0, 10))
  }
  return days
}
