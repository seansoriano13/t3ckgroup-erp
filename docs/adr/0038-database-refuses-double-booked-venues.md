# ADR 0038 — The database refuses a double-booked Venue

## Status
Accepted

## Context

A Venue may host only one meeting at a time, and a Meeting Request holds its
slot from the moment it is filed until it is declined or cancelled. Checking
for an overlap in the browser, or in the service layer before inserting, leaves
a gap: two people filing for the same slot at the same moment both pass the
check and both get saved.

## Decision

The rule lives in the table as an exclusion constraint (`btree_gist`): no two
Meeting Requests for the same Venue may have overlapping time ranges while
either is pending, returned or approved. Declined and cancelled requests drop
out of the constraint, which frees their slot. Different Venues never conflict
with each other.

The booking form still shows the Venue's existing bookings and warns before
sending, but that is a convenience; the constraint is the rule.

## Consequences

- A clash surfaces as a database error that the service turns into a plain
  message naming the meeting already holding the slot.
- Time ranges are half-open (`[start, end)`), so a meeting ending at 10:00 and
  the next one starting at 10:00 do not clash.
- The fake database in the unit tests does not enforce constraints, so the rule
  is covered by the policy test tier (`pnpm test:db`).
