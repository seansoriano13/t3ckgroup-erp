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
