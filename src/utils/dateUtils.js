/**
 * Standardized date utilities for month-range calculations
 * to prevent edge-case bugs around leap years and year rollovers.
 */

/**
 * Returns the first day of the selected month and the first day of the NEXT month.
 * Useful for .gte(start) and .lt(nextMonthStart) queries.
 * @param {string} monthYearStr - Format "YYYY-MM"
 * @returns {{ startDate: string, endDate: string }} 
 */
export function getMonthBoundaries(monthYearStr) {
  const [year, month] = monthYearStr.split("-").map(Number);
  
  // Start of current month (e.g., 2026-03-01)
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  
  // Start of NEXT month
  const nextMonthDate = new Date(year, month, 1); // JS Date months are 0-indexed, so 'month' here is actually next month
  const nextYear = nextMonthDate.getFullYear();
  const nextMonth = nextMonthDate.getMonth() + 1;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  
  return { startDate, endDate };
}

/**
 * Returns the start and end string for a generic date range.
 * @param {Date} date 
 * @returns {string} YYYY-MM-DD
 */
export function formatDateToYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Lists every date from `startDate` to `endDate` inclusive, as "YYYY-MM-DD"
 * strings. Used to expand a date-range leave application into its day-rows.
 * @param {string} startDate - "YYYY-MM-DD"
 * @param {string} endDate - "YYYY-MM-DD"
 * @returns {string[]}
 */
export function enumerateDateRange(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const start = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const dates = [];
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10)); // eslint-disable-line local/no-iso-date-slice -- UTC midnight from plain y/m/d, no instant involved
  }
  return dates;
}

/**
 * Returns boundaries for a calendar quarter.
 * @param {number} year - e.g. 2026
 * @param {number} quarter - 1-4
 * @returns {{ startDate: string, endDate: string }}
 */
export function getQuarterBoundaries(year, quarter) {
  const startMonth = (quarter - 1) * 3; // 0, 3, 6, 9
  const startDate = `${year}-${String(startMonth + 1).padStart(2, "0")}-01`;
  const endMonthDate = new Date(year, startMonth + 3, 1); // first day of month AFTER quarter
  const endDate = `${endMonthDate.getFullYear()}-${String(endMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
  return { startDate, endDate };
}

/**
 * Returns boundaries for an entire year.
 * @param {number} year
 * @returns {{ startDate: string, endDate: string }}
 */
export function getYearBoundaries(year) {
  return { startDate: `${year}-01-01`, endDate: `${year + 1}-01-01` };
}

/**
 * Returns an array of "YYYY-MM-01" keys for all months within a date range.
 * Used for summing monthly quotas across quarters/years.
 * @param {string} startDate - "YYYY-MM-DD"
 * @param {string} endDate   - "YYYY-MM-DD" (exclusive)
 * @returns {string[]}
 */
export function getMonthKeysInRange(startDate, endDate) {
  const keys = [];
  const [sy, sm] = startDate.split("-").map(Number);
  // Both ends must be built from local parts. `new Date("2026-04-01")` parses as
  // UTC midnight, which in any zone ahead of UTC sits AFTER local April 1 — so
  // the exclusive end month was being included, over-counting every quarterly
  // and yearly quota by one month.
  const [ey, em, ed] = endDate.split("-").map(Number);
  const endD = new Date(ey, em - 1, ed);
  let cursor = new Date(sy, sm - 1, 1);
  while (cursor < endD) {
    keys.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`
    );
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

/**
 * Returns human-readable label for a quarter.
 * @param {number} quarter - 1-4
 * @param {number} year
 * @returns {string}
 */
export function getQuarterLabel(quarter, year) {
  return `Q${quarter} ${year}`;
}

/**
 * Derives quarter number (1-4) from a month string "YYYY-MM".
 */
export function getQuarterFromMonth(monthStr) {
  const month = parseInt(monthStr.split("-")[1], 10);
  return Math.ceil(month / 3);
}

