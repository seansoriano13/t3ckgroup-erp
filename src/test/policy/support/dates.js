/**
 * Dates for the policy tests that file an Activity. The database refuses a day more than one year ahead
 * (#1087), so a test can no longer use a fixed year far in the future. Everything here counts from today.
 *
 * `ahead(n)` is [year, monthIndex, day] of the UTC date n days from today, to spread into `Date.UTC`:
 *
 *     Date.UTC(...ahead(90 + n), 1, 0, 0)   // 01:00 UTC (09:00 Manila) on day 90 + n
 *
 * Every test file keeps to its own stretch of days (the first number), as it kept to its own year before,
 * and stays under 330 days so the limit never bites. A row a test inserts straight into the table is not
 * held to the limit, so those may sit further out.
 */
export const ahead = (days) => {
    const d = new Date(Date.now() + days * 86_400_000)
    return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]
}

/** The first Monday on or after day `days` from today, as an offset in days (for tests that need weekdays). */
export const mondayOnOrAfter = (days) => {
    const [y, m, d] = ahead(days)
    const weekday = new Date(Date.UTC(y, m, d)).getUTCDay() // 0 Sunday .. 6 Saturday
    return days + ((8 - weekday) % 7)
}
