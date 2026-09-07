/**
 * Pure time math module for Offsets and Leaves.
 */

/**
 * Parse a HH:mm string into minutes since midnight.
 * @param {string} timeStr - The time string (e.g., '14:30', '09:00:00')
 * @returns {number|null} - Minutes since midnight, or null if invalid
 */
export function parseTime(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

/**
 * Derives hours between two times.
 * @param {string} start - Start time 'HH:mm'
 * @param {string} end - End time 'HH:mm'
 * @param {boolean} allowOvernight - If true, handles end < start by adding 24h
 * @returns {number} - Derived hours, e.g. 8.5
 */
export function deriveHours(start, end, allowOvernight = false) {
  const startMins = parseTime(start);
  const endMins = parseTime(end);
  
  if (startMins === null || endMins === null) return 0;
  
  let diff = endMins - startMins;
  if (diff < 0) {
    if (allowOvernight) {
      diff += 24 * 60;
    } else {
      throw new Error('End time must be after start time.');
    }
  }

  // Return rounded to 2 decimals
  return Number((diff / 60).toFixed(2));
}

/**
 * Derives hours, or 0 where the window is incomplete or invalid.
 *
 * `deriveHours` throws on a backwards window because a service handing one to
 * the database wants to be stopped. A form is the opposite case: it sees every
 * half-finished window the user types on the way to a valid one — an end time
 * lands before the start time constantly during editing — and a throw there
 * takes the render down. Both callers are asking about the same rule, so it
 * stays in one place and only the failure mode differs.
 */
export function safeDeriveHours(start, end, allowOvernight = false) {
  try {
    return deriveHours(start, end, allowOvernight);
  } catch {
    return 0;
  }
}

/**
 * Format a HH:mm time string into AM/PM.
 */
export function formatTime(timeStr) {
  if (!timeStr) return '';
  let parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; 
  return `${hours}:${minutes} ${ampm}`;
}

/**
 * Format a window string.
 */
export function formatWindow(start, end) {
  if (!start || !end) return '';
  return `${formatTime(start)} - ${formatTime(end)}`;
}

/**
 * Renders a leave group's dates as the label every notification and audit line
 * about that group uses. A group of one reads as its single date; a range reads
 * as its span, with the day count added where the message is about the decision
 * rather than the dates themselves. `dates` arrives already sorted from the
 * decision RPCs, which is where a group's dates are now assembled.
 */
export function describeLeaveRange(dates, { withDayCount = false } = {}) {
  const days = dates || [];
  if (days.length <= 1) return days[0];
  const span = `${days[0]} to ${days[days.length - 1]}`;
  return withDayCount ? `${span} (${days.length} days)` : span;
}

/**
 * A window at its shortest, for the calendar's month cells.
 *
 * Those cards are 9px text in a cell narrow enough to truncate, and the card
 * already carries the hours and a coloured dot for the type — so everything
 * that repeats is dropped: `:00` minutes, and the opening AM/PM when both ends
 * share it. `9:00 AM - 5:00 PM` becomes `9AM–5PM`, and `1:00 PM - 4:00 PM`
 * becomes `1–4PM`.
 */
export function formatWindowCompact(start, end) {
  const startMins = parseTime(start);
  const endMins = parseTime(end);
  if (startMins === null || endMins === null) return '';

  const part = (mins, { withMeridiem }) => {
    const hours24 = Math.floor(mins / 60) % 24;
    const minutes = mins % 60;
    const hours = hours24 % 12 || 12;
    const clock = minutes === 0 ? `${hours}` : `${hours}:${String(minutes).padStart(2, '0')}`;
    return withMeridiem ? `${clock}${hours24 >= 12 ? 'PM' : 'AM'}` : clock;
  };

  const sameMeridiem = startMins < 720 === endMins < 720;
  return `${part(startMins, { withMeridiem: !sameMeridiem })}–${part(endMins, { withMeridiem: true })}`;
}

/**
 * Orders leaves within a day by when they start.
 *
 * A day cell shows only its first few cards and hides the rest behind a count,
 * so without an order the three a viewer sees are whichever the source arrays
 * happened to concatenate first. Rows with no window sort last: they predate
 * the window columns and have no position in a day.
 */
export function compareByStartTime(a, b) {
  const left = parseTime(a?.start_time);
  const right = parseTime(b?.start_time);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

/**
 * Checks if two time windows overlap.
 * Time windows are objects {start: 'HH:mm', end: 'HH:mm'}
 */
export function windowsOverlap(w1, w2) {
  const getTimeline = (w) => {
    let start = parseTime(w.start);
    let end = parseTime(w.end);
    if (start === null || end === null) return null;
    if (end < start) {
      end += 24 * 60; // it goes into Day 2
    }
    return { start, end };
  };

  const t1 = getTimeline(w1);
  const t2 = getTimeline(w2);

  if (!t1 || !t2) return false;

  // Overlap condition: max(start1, start2) < min(end1, end2)
  return Math.max(t1.start, t2.start) < Math.min(t1.end, t2.end);
}

/**
 * Checks if a request date falls within a specific pending period filter.
 * @param {string|Date} requestDate - The date of the request
 * @param {string} periodFilter - 'ALL', 'THIS_MONTH', 'NEXT_MONTH', 'OVERDUE'
 * @returns {boolean}
 */
export function isRequestInPendingPeriod(requestDate, periodFilter) {
  if (periodFilter === 'ALL') return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const reqDateObj = new Date(requestDate);
  const reqMonth = reqDateObj.getMonth();
  const reqYear = reqDateObj.getFullYear();

  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  if (periodFilter === 'OVERDUE') {
    reqDateObj.setHours(0, 0, 0, 0);
    return reqDateObj < today;
  } else if (periodFilter === 'THIS_MONTH') {
    return reqMonth === currentMonth && reqYear === currentYear;
  } else if (periodFilter === 'NEXT_MONTH') {
    const nextMonth = (currentMonth + 1) % 12;
    const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    return reqMonth === nextMonth && reqYear === nextMonthYear;
  }

  return true;
}
