# ADR 0027 — Resume moves Stage Work to the new visit

## Status

Accepted 2026-09-26, from the SOR History grilling session. Constrains how
issue #384's Resume is built.

## Context

The History (formerly the Journey) shows each Stage Visit's whole Stage Work.
A Resume carries an earlier visit's work into the new visit on the same Stage —
held tasks reopen, and ticks, condition files, custom Stage Field values,
Optional Action decisions and the Follow-up count come with them. The same
item then belongs to two visits, and the History has to show it somewhere.

## Decision

**Resumed work moves to the new visit and shows there only.** Each item keeps
its original who and when, marked as coming from an earlier visit. The earlier
visit keeps one line saying it was resumed, on what date, with its work carried
forward. Every piece of Stage Work belongs to exactly one visit at a time.

## Considered options

- **Show it on both visits.** Rejected: the same tick or task appears twice,
  and counts on the two visits no longer add up to the SOR's real work.
- **Leave it on the earlier visit; the new visit points back.** Rejected: the
  current visit's conditions would be met by work the Now tab cannot see on its
  own visit, and every "what does this visit have" question becomes a walk
  back through earlier visits.

## Consequences

- A resumed item can carry a date earlier than the visit it sits on. That is
  expected, not a data error; the "from an earlier visit" mark explains it.
- The earlier visit looks emptier after a Resume than it did when it was left.
  Its one "resumed" line is what records that the work happened there first.
- Reverting a Return undoes its Resume (CONTEXT.md, Revert), which moves the
  work back to the earlier visit.
