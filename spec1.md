## Problem Statement

An Offset, an overtime claim and an SIL leave are all recorded as a date and a number of hours. Nobody can say *when*.

That costs three different people something different. The employee filing overtime has no way to record that they stayed 6pm to 9pm — they type "3" and the fact of which three hours is lost the moment they submit. The HR officer approving it is asked to approve a quantity with no window, and cannot tell a genuine evening shift from three hours claimed against a day the employee was demonstrably elsewhere. And the colleague looking at the calendar board sees "4h OFFSET" against a teammate's name and still has to message them to find out whether they can be reached at 2pm.

Because hours are typed directly, they are also the only thing that can be wrong. An employee who works 6pm–9pm and types "4" has filed a claim nothing in the system can contradict, and it credits four hours to their offset balance.

## Solution

Every overtime request, Offset leave and SIL leave carries a start time and an end time, and the hours are derived from them rather than typed.

The application form asks for the window. The hours total appears live beneath it, read-only — the employee sees "3.0 hrs" appear as they set 6:00 PM to 9:00 PM, and there is no longer a field in which to disagree with that. Overtime may cross midnight; a 10pm–2am shift derives four hours. Offset and SIL leaves may not, because a leave that runs past midnight is a data entry error rather than a night shift.

Everywhere hours are shown today, the window is shown beside them: the employee's own history lists, the HR approval queues, the notification an employee receives when HR decides, the system audit line, and the calendar board.

Requests that overlap an existing request on the same day are rejected at submission, which is only possible now that a request occupies a window rather than a quantity.

Rows filed before this change have no times. They keep reading exactly as they do today — "3 hrs" with no window — rather than being backfilled with a guess or rendered as midnight-to-midnight.

## User Stories

1. As an employee filing overtime, I want to enter the hours I actually worked as a start and end time, so that the record says I stayed 6pm to 9pm rather than that I claimed three hours.
2. As an employee filing overtime, I want the hours total calculated for me from the window I entered, so that I cannot accidentally claim more hours than the window contains.
3. As an employee filing overtime, I want to see the derived hours update as I set the times, so that I can confirm the claim is what I intended before I submit it.
4. As an employee who worked a night shift, I want to file overtime that runs from 10pm to 2am, so that work spanning midnight can be claimed at all.
5. As an employee applying for an Offset leave, I want to say which hours of the day I will be away, so that my team knows when I can be reached.
6. As an employee applying for an SIL leave, I want to say which hours of the day I will be away, so that a half-day is unambiguous about which half.
7. As an employee, I want to be told when my leave overlaps a request I have already filed for the same day, so that I do not double-book myself and spend the same balance twice.
8. As an employee, I want an Offset or SIL leave that runs past midnight to be rejected, so that a mistyped PM is caught rather than silently doubling my claim.
9. As an employee, I want my request history to show the window alongside the hours, so that I can see at a glance which of my three requests on one date was the evening one.
10. As an employee, I want the notification telling me HR's decision to name the window, so that I know which of my requests was approved without opening the app.
11. As an employee whose old requests predate this change, I want them to keep displaying as they always have, so that my history does not fill up with invented times.
12. As an HR officer reviewing an overtime request, I want to see the window the employee is claiming, so that I can judge whether the claim is plausible before crediting their offset balance.
13. As an HR officer, I want the hours I am approving to be derived from the claimed window, so that the balance I credit and the time the employee says they worked cannot disagree.
14. As an HR officer reviewing an Offset or SIL leave, I want to see when the employee will be away, so that I can weigh it against coverage on that day.
15. As an HR officer, I want the audit log entry to record the window, so that an approval can be reconstructed months later from the log alone.
16. As an HR officer, I want to be prevented from editing the times on a request I have already decided, so that a balance that has already been credited or debited cannot silently fall out of step with the record it came from.
17. As an HR officer who needs to correct an approved request, I want to undo my decision back to Pending first, so that the balance is reversed by the path that already knows how to reverse it.
18. As an employee viewing the calendar board, I want each leave card to show the window, so that I can tell whether a colleague is out in the morning or the afternoon without opening anything.
19. As an employee viewing the calendar board, I want the cards in a day to be ordered by start time, so that the day reads chronologically.
20. As an employee viewing a busy day on the calendar board, I want the three visible cards to be the earliest three rather than an arbitrary three, so that the overflow button hides a predictable remainder.
21. As an employee opening a leave on the calendar board, I want the detail panel to show the window under the duration, so that the full record is available where I already look for it.
22. As an employee viewing the calendar board, I want a leave filed before this change to show its hours with no window, so that the board does not claim a precision the record does not have.
23. As a developer, I want the derivation, formatting and overlap rules to live in one module, so that the calendar, the forms, the services and the notification strings cannot drift apart on what a window means.

## Implementation Decisions

**Schema.** One migration adds two nullable `TIME` columns — a start and an end — to each of the three request tables (overtime requests, Offset leaves, SIL leaves). Nullable and no backfill: every existing row keeps null times and the display falls back to hours alone.

`TIME` rather than `TIMESTAMPTZ`, and the existing date column is untouched. The whole company is in one timezone, the test suite already pins to Asia/Manila for exactly this reason, and every existing row is date-only. A `TIMESTAMPTZ` pair would make the date column redundant and rewrite the shape of every query that filters a date range.

The hours column stays. It is what the balance arithmetic, the notification strings and the audit lines read, and every historical row has only that. It becomes a derived value rather than an entered one.

Before writing the migration, verify the live schema directly rather than trusting the migration ledger — this repo's numbering already has a gap, and prod's ledger has been observed to disagree with prod's actual schema in both directions.

**A new pure time module.** One module owns three rules and is the only place any of them exists:

- Derive hours from a window. Where the end is at or before the start, add 24 hours — permitted for overtime, rejected for Offset and SIL.
- Format a window for display, returning nothing for a null window so every caller's fallback is the same.
- Decide whether two windows on the same date overlap.

It is pure, takes no I/O, and is the seam the unit tests target. Without it the derivation is written three times and the formatter five.

**Services.** The three apply methods take a start and end instead of hours, derive the hours through the new module, and reject an overlap against the employee's existing requests for that date across all three tables. The overlap check sits in the services beside the weekend and balance guards that are already there — it is a data-entry mistake being caught, and a cross-table exclusion constraint is not something Postgres offers without a fourth table.

The application form is the only write path into these tables; there is no HR-applies-on-behalf route, so the derivation has exactly one entry point to enforce.

**Decided requests are frozen.** Times cannot be edited once HR has decided, because the hours are derived and a change would move a balance that has already settled. The existing undo-decision path already knows how to reverse a balance; HR undoes to Pending, edits, and re-approves.

**Calendar board.** Stays scoped to approved Offset and SIL leaves — overtime is not added. The board answers "who is away", and someone working late is not away.

The month cell card becomes hours, then the window: the type word is dropped, since the coloured dot already encodes type and the word was the least informative token in a 9px string. This keeps one line and three cards per day. Cards within a day sort by start time ascending with null-time rows last. The detail panel's duration tile gains the window as a second line inside the same tile rather than a fourth tile, which would push the type tile off its full-width row.

**Display surfaces.** The window appears in the employee's own history lists, the HR approval queues, the decision notification, and the audit log line. All of them format through the new module, so a null window degrades identically everywhere.

## Testing Decisions

A good test here asserts what a caller can observe — the hours that landed on the row, the balance after a decision, the text a user reads — never how the derivation was reached. The existing service tests are the model: they call the service and then read the row back through another service call.

**Unit tier — the new time module.** Derivation across a normal window, a window ending exactly at the start, and a window crossing midnight with overnight allowed and disallowed. Formatting of a populated window and a null one. Overlap across touching, nested, and disjoint windows. Prior art for the extraction is `src/utils/approvalQueue.js`, which `docs/testing.md` names as the worked example.

**Integration tier — the three services against the fake database.** That the derived hours reach the row, that an overlapping request is rejected, that an overnight Offset leave is rejected while overnight overtime is accepted, that the balance credited on approval matches the derived hours, and that a legacy row with null times still reads back. The fake database builds its schema by reading every file in the migrations directory in order, so the new columns arrive there the moment the migration lands — no test plumbing required.

**Integration tier — the calendar board.** Through the existing offsets page test: that a card shows the window, that a null-time leave shows hours alone, and that cards within a day come out in start-time order.

## Out of Scope

- Overtime on the calendar board. If it is wanted it should be a toggleable layer with its own colour, as its own issue.
- Backfilling times onto existing rows.
- Editing times on a request HR has already decided, other than via the existing undo path.
- Any validation of a window against an employee's shift or roster — the system holds no roster.
- A database-level exclusion constraint for overlaps.
- Minute-level payroll rounding rules.

## Further Notes

The overlap check is app-side and therefore racy — two tabs submitting simultaneously can both pass it, exactly as the existing balance check can. That is a known and accepted property of the guards it sits beside, not an oversight.

Deriving hours narrows an existing hole: today an employee can work three hours and claim four, and nothing in the system can contradict them.
