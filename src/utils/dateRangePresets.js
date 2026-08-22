// The named reporting periods the Commission Dashboard filters by, and the
// concrete `YYYY-MM-DD` bounds each one resolves to.
//
// Every date these bounds are compared against — an Opportunity's
// contract_date, its created_at — is a local Asia/Manila calendar day (see
// the TZ note in vitest.config.js). So the bounds have to be read off the
// local calendar too. Building them with `toISOString()` converts to UTC
// first, which in a UTC+8 zone lands on the previous day for any local time
// before 08:00 — and midnight, which is what a month boundary is, is always
// before 08:00. That shifted every bound a day early: "This Month" ran from
// the last day of the previous month through the second-to-last day of this
// one, and "Year-To-Date" always stopped at yesterday.

export const DATE_PRESETS = [
  { value: "ALL", label: "All Time" },
  { value: "CYCLE", label: "Sales Cycle (Apr - Mar)" },
  { value: "CYCLE_FIRST", label: "1st Cycle (Apr - Sep)" },
  { value: "CYCLE_SECOND", label: "2nd Cycle (Oct - Mar)" },
  { value: "PREV_CYCLE", label: "Previous Sales Cycle" },
  { value: "THIS_MONTH", label: "This Month" },
  { value: "LAST_MONTH", label: "Last Month" },
  { value: "Q1", label: "Q1 (Jan - Mar)" },
  { value: "Q2", label: "Q2 (Apr - Jun)" },
  { value: "Q3", label: "Q3 (Jul - Sep)" },
  { value: "Q4", label: "Q4 (Oct - Dec)" },
  { value: "YTD", label: "Year-To-Date (YTD)" },
];

/**
 * The calendar year the Sales Cycle containing `now` began in.
 *
 * CCPR-2026-001 runs the Sales Cycle from 1 April to 31 March, so the cycle a
 * date belongs to is not its calendar year: January through March fall in the
 * cycle that opened the previous April. Everything else here is derived from
 * this, which is why it is worth naming.
 */
export function getSalesCycleStartYear(now = new Date()) {
  // getMonth() is zero-based; 3 is April.
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * The two halves of a Sales Cycle, named as the regulation names them.
 *
 * The halves are the commission release periods: the November Release covers
 * 1 April to 30 September (the First Cycle, target PHP 99M) and the May
 * Release covers 1 October to 31 March (the Second Cycle, target PHP 121M).
 * The second half straddles the new year, which is the whole reason these
 * bounds are built from a cycle start year rather than a calendar one.
 */
export function getSalesCycleRange(startYear, half = "FULL") {
  if (half === "FIRST") {
    return { startDate: `${startYear}-04-01`, endDate: `${startYear}-09-30` };
  }
  if (half === "SECOND") {
    return { startDate: `${startYear}-10-01`, endDate: `${startYear + 1}-03-31` };
  }
  return { startDate: `${startYear}-04-01`, endDate: `${startYear + 1}-03-31` };
}

/** `YYYY-MM-DD` for a Date, read off the local calendar rather than UTC. */
export function toLocalIsoDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Inclusive `{ startDate, endDate }` for a preset, or null for "ALL" and any
 * unrecognised value. `now` is injectable so the boundaries can be tested
 * without waiting for a particular day to come around.
 */
export function getPresetDateRange(preset, now = new Date()) {
  const year = now.getFullYear();
  const cycleStart = getSalesCycleStartYear(now);

  if (preset === "CYCLE") return getSalesCycleRange(cycleStart);
  if (preset === "CYCLE_FIRST") return getSalesCycleRange(cycleStart, "FIRST");
  if (preset === "CYCLE_SECOND") return getSalesCycleRange(cycleStart, "SECOND");
  if (preset === "PREV_CYCLE") return getSalesCycleRange(cycleStart - 1);

  if (preset === "THIS_MONTH") {
    return {
      startDate: toLocalIsoDate(new Date(year, now.getMonth(), 1)),
      // Day 0 of the next month is the last day of this one.
      endDate: toLocalIsoDate(new Date(year, now.getMonth() + 1, 0)),
    };
  }
  if (preset === "LAST_MONTH") {
    return {
      startDate: toLocalIsoDate(new Date(year, now.getMonth() - 1, 1)),
      endDate: toLocalIsoDate(new Date(year, now.getMonth(), 0)),
    };
  }
  if (preset === "Q1") return { startDate: `${year}-01-01`, endDate: `${year}-03-31` };
  if (preset === "Q2") return { startDate: `${year}-04-01`, endDate: `${year}-06-30` };
  if (preset === "Q3") return { startDate: `${year}-07-01`, endDate: `${year}-09-30` };
  if (preset === "Q4") return { startDate: `${year}-10-01`, endDate: `${year}-12-31` };
  if (preset === "YTD") return { startDate: `${year}-01-01`, endDate: toLocalIsoDate(now) };

  return null;
}
