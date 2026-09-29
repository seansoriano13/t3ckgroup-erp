# ADR 0026 — Revert clears the Contract Date

## Status

Accepted 2026-09-26, from the stage-revert grilling session. Narrows ADR 0006,
which relied on the Contract Date being "already never un-stamped".

## Context

Reaching the Won Stage stamps the Contract Date, and the Contract Date fixes an
SOR's commission pricing forever. Nothing has ever cleared it. So a misclick
into the Won Stage, or a deal that is won and then really falls back, leaves a
date stamped on an SOR that is no longer won — and because the stamp only
happens when no date exists yet, winning it again later keeps the wrong date
and prices commission from it.

## Decision

**Revert is the one thing that clears a Contract Date.** Reverting a move that
landed on the Won Stage clears the date that move stamped; the next time the
SOR reaches the Won Stage it is stamped afresh. An ordinary move off the Won
Stage along a drawn edge still clears nothing — the one-way stamp holds
everywhere except Revert, which exists to say the move should not stand.

## Considered options

- **Never clear it; fix mistakes in the database by hand.** Keeps ADR 0006's
  guarantee literally, but every fix is an unaudited edit to the one field
  commission pricing hangs on.
- **Clear it on any move off the Won Stage.** Rejected: a deal that genuinely
  moves on past Won and loops back would lose the date it was really won on.

## Consequences

- Commission reports can no longer assume a Contract Date, once seen, is
  permanent. A Revert is logged, so the history of a cleared date is on the
  SOR's timeline and audit log.
