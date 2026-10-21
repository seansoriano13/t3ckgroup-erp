// ADR 0039: a date means the date in Asia/Manila. This is the one module that
// turns instants into dates and answers "what day is it". Do not build date
// strings from `toISOString()` elsewhere (the local/no-iso-date-slice rule
// enforces it).
import { TZDate } from '@date-fns/tz'
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay as fnsIsSameDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

export const MANILA_TZ = 'Asia/Manila'
const WEEK = { weekStartsOn: 1 } // Monday first

/** Wrap an instant (Date, ms or ISO string) so wall-clock fields read in Manila. */
export function toManila(instant = new Date()) {
  return new TZDate(new Date(instant).getTime(), MANILA_TZ)
}

/** Today's Manila date as `YYYY-MM-DD`. */
export function manilaToday(now = new Date()) {
  return format(toManila(now), 'yyyy-MM-dd')
}

/** An instant as a Manila `YYYY-MM-DD`. */
export function manilaDate(instant) {
  return format(toManila(instant), 'yyyy-MM-dd')
}

/** An instant as a Manila `HH:mm` (24h). */
export function manilaTime(instant) {
  return format(toManila(instant), 'HH:mm')
}

/** A `YYYY-MM-DD` as a Manila-midnight date. */
export function parseManilaDate(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  return new TZDate(y, m - 1, d, MANILA_TZ)
}

function asManila(value) {
  return typeof value === 'string' ? parseManilaDate(value) : toManila(value)
}

/** Every day in the month's grid (Monday-first weeks), as Manila dates. */
export function monthGrid(anyDayInMonth) {
  const base = asManila(anyDayInMonth)
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(base), WEEK),
    end: endOfWeek(endOfMonth(base), WEEK),
  })
}

/** The seven days of the Monday-first week containing the given day. */
export function weekGrid(anyDayInWeek) {
  const start = startOfWeek(asManila(anyDayInWeek), WEEK)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** The single-day grid: the given day at Manila midnight. */
export function dayGrid(anyDay) {
  const base = asManila(anyDay)
  return [new TZDate(base.getFullYear(), base.getMonth(), base.getDate(), MANILA_TZ)]
}

/** Same calendar day in Manila. */
export function isSameManilaDay(a, b) {
  return fnsIsSameDay(toManila(a), toManila(b))
}

/** True when an `HH:mm` time sits on a 15-minute step. */
export function isFifteenMinuteStep(hhmm) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(hhmm))
  return Boolean(match) && Number(match[1]) < 24 && Number(match[2]) < 60 && Number(match[2]) % 15 === 0
}
