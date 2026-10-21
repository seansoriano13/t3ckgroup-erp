# ADR 0037 — The Calendar reads one server projection of every dated record

## Status
Accepted

## Context

The Calendar (see CONTEXT.md) is meant to be the one place every dated record
shows: Meeting Requests and Time Off and overtime now, holidays and deadlines
later. Before it, each calendar fetched its own tables in the browser and
merged them there, and ADR 0012 had to add narrow per-table queries so a
colleague's leave reason never reached an employee's browser. Doing that again
for every new kind of entry would multiply both the fetches and the places a
private column could slip through.

## Decision

The Calendar reads one Postgres function, `calendar_entries(from, to)`, that
returns every kind of entry in one shape (kind, id, group, who, when, venue,
status, and a small details object). Each kind of entry is one branch of that
function. Private fields such as a leave's reason are returned only to HR and
to the entry's own employee, decided inside the function rather than by which
columns a browser query happens to select.

On the browser side, a registry keyed by kind holds everything the screen needs
to draw an entry: its label, color, icon and detail panel. A new kind of entry
is one new branch in the function and one new registry entry; no screen
changes.

HR's Time Off & Overtime tab and the employee's My Requests tab are filtered
views of the same Calendar, not separate calendars.

## Considered Options

- **Each kind fetched separately in the browser and merged there** (how the old
  leave calendars worked). Rejected: one request per kind per month, and every
  new kind is a new chance to select a private column by mistake.
- **A database view instead of a function.** Rejected: a view cannot decide
  per viewer whether to include a reason, and it cannot take the date range as
  input, so filtering would have to happen after reading too much.

## Consequences

- Supersedes ADR 0012's per-table calendar queries once the old calendars are
  moved onto the Calendar.
- The function is the one place to check when asking "can an employee see this
  field of a colleague's record?".
- The fake database in the unit tests does not run SQL, so the function's
  privacy rule is covered by the policy test tier (`pnpm test:db`).
