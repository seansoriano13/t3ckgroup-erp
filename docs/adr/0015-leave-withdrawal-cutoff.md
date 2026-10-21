# ADR 0015 — The cutoff for withdrawing an approved leave

## Status
Accepted — its UTC comparison is superseded by ADR 0039: "today" is now the
date in Manila on both the database and the browser side, so the rule is exact
rather than one day lenient before 8 AM. The cutoff itself (the leave's first
date) stands.

## Context

Issue #111 (HR-06) found that both the Offset withdrawal and the SIL
cancellation refused only records that were already rejected or cancelled.
Neither looked at the date, so an approved leave dated last January could be
withdrawn today and its hours credited straight back onto the balance. It was
reproduced: an approved leave dated 2020-01-06 was withdrawn and 8 hours
refunded. HR was notified — but only after the balance had already moved.

Refusing the refund needs a cutoff, and the cutoff is a policy decision rather
than a technical one. Two candidates were on the table:

- **The leave's own date.** The obvious anchor: hours are spent when the day is
  taken.
- **The filing deadline the printed forms already carry.** TG-11 states "This
  form must be filed before the leave commences", and `isLateFiling`
  (`src/lib/pdf/layout.js`) marks a form late by comparing its filing date to
  the leave's start date.

## Decision

**The cutoff is the leave's first date.** An employee may withdraw an approved
leave only while it has not yet started; once its first date is in the past,
the hours are treated as taken and only HR can give them back. Offset and SIL
apply the identical rule, with the identical message — an employee has no
reason to learn two rules for the same act.

The filing-deadline anchor was not chosen, because it describes when a leave
may be *filed*, not how long it stays reversible — and it resolves to the same
day anyway, the day the leave commences. Using the leave's own first date says
the same thing without borrowing a rule written to answer a different question.

Two edges were settled deliberately:

- **The guard applies to an APPROVED group only.** A PENDING leave has spent
  nothing, so there is no refund to refuse, and guarding it would strand a
  past-dated application in HR's queue with no way for the employee to take it
  back.
- **A leave whose first date is today is still withdrawable.** "Already taken"
  means the date has passed. `CURRENT_DATE` in Postgres is UTC while the office
  is UTC+8, so the boundary lands one day lenient rather than one day harsh —
  the safe direction, because a wrongly-refused withdrawal has no correction
  path while a wrongly-allowed one does (HR re-decides).

**HR's undo stays unguarded**, and is the correction route for the genuine case
the ticket raised: someone approved for a day they then did not take. HR undoes
the decision, which refunds the hours and returns the group to PENDING, and
then rejects it. That keeps the correction with the people who can verify it
actually happened, rather than letting the balance move on the employee's own
say-so months later.

## Consequences

- `withdraw_offset_leave` and `cancel_sil_leave` raise when an approved group's
  earliest date is before `CURRENT_DATE`, naming that date and pointing at HR.
  The message reaches the employee through the existing toast on both pages.
  The guard lives in the same migrations that create those two functions
  (#109's and #110's) rather than in a third one replacing their bodies
  moments later: the three tickets land together and none of the functions had
  reached a ledger, so one definition of each is the honest one.
- The only affordance that can withdraw an approved leave is the calendar's
  "Withdraw Leave" button, and it was already close to this rule —
  `NotionLeaveCalendar` rendered it only for a leave dated after today. It was
  guarding on the *clicked day* rather than the leave, though, so a range that
  began yesterday still offered the button on tomorrow's card and the server
  would refuse it. The calendar now asks the same question the function asks,
  the same way it asks it: has the group's first day passed, compared as
  `YYYY-MM-DD` strings against today in UTC? Parsing either side into a `Date`
  would have put the boundary eight hours into the Manila working day, and
  `<=` would have excluded the start day this ADR deliberately keeps
  withdrawable — so the comparison is written to mirror `first_date <
  CURRENT_DATE` exactly, and a test pins the start-day boundary. The rule is
  enforced where it can be relied on, and the UI no longer offers a button that
  only leads to a refusal.
- `undo_offset_leave_decision` / `undo_sil_leave_decision` are deliberately
  exempt. A future ticket that adds a date guard to a decision path should not
  add one there without replacing the correction route first.
- Tests that withdraw a leave successfully can no longer use a hard-coded date;
  both service suites build one from `upcomingWeekdays()`, since a fixed future
  date stops being one the moment the calendar passes it.
