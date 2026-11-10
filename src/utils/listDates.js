// Dates in Purchasing lists (spec #631): ages read "3d", dates read "Oct 22",
// with the year only when it is not this year. Times stay inside records.
// Built on the Manila date module (ADR 0039), so a day is a Manila day.
import { differenceInCalendarDays, format } from 'date-fns'
import { parseManilaDate, toManila } from '../lib/manilaDate.js'

// A plain `YYYY-MM-DD` is already a Manila date; anything else is an instant.
const asManila = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseManilaDate(value) : toManila(value)

const isBlank = (value) => value === null || value === undefined || value === ''

/** Whole Manila days from `value` to `now` (0 for today, never negative), or null when there is no date. */
export function listAgeDays(value, now = new Date()) {
  if (isBlank(value)) return null
  return Math.max(0, differenceInCalendarDays(toManila(now), asManila(value)))
}

/** A whole number of days as "3d"; "" when there is no number. The one place an age is spelled. */
export function formatAgeDays(days) {
  return days === null || days === undefined ? '' : `${days}d`
}

/** An age as "3d"; "" when there is no date. */
export function listAge(value, now = new Date()) {
  return formatAgeDays(listAgeDays(value, now))
}

/** A date as "Oct 22", or "Oct 22, 2025" when it is not this year (in Manila); "" when there is no date. */
export function listDate(value, now = new Date()) {
  if (isBlank(value)) return ''
  const date = asManila(value)
  const sameYear = date.getFullYear() === toManila(now).getFullYear()
  return format(date, sameYear ? 'MMM d' : 'MMM d, yyyy')
}
