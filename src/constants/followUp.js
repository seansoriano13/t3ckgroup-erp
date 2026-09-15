/**
 * Pure mirror of the SQL `sor_due_follow_ups` due-rule (issue #204, Follow-up
 * Cadence). Reminders chase silence, not the calendar: a reminder is due
 * `everyDays` after the latest of entering the Stage, the last logged
 * follow-up, and the last reminder sent. Kept as a literal port of the SQL
 * `greatest(...) + interval` expression so client and server never disagree
 * about "Next reminder due" — see `sor_due_follow_ups` in the Part 3
 * migration for the server-side twin.
 */
export function nextFollowUpDue({ enteredAt, lastLoggedAt, lastReminderAt, everyDays, leftAt } = {}) {
  if (!enteredAt || !everyDays || everyDays <= 0) return null
  // A closed visit (the SOR has left the Stage) never has a next reminder —
  // reminders stop the moment the SOR moves on (user story 30).
  if (leftAt) return null

  const candidates = [enteredAt, lastLoggedAt, lastReminderAt]
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
  const latest = Math.max(...candidates)

  return new Date(latest + everyDays * 24 * 60 * 60 * 1000).toISOString()
}
