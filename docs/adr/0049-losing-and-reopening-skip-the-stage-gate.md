# ADR 0049 — Losing and reopening skip the Stage gate

## Status

Accepted 2026-10-30, from the Mark as Lost grilling (spec #799, ticket #810).

## Context

People delete a dead deal because marking it Lost is hard. On Flow Canvas a deal
reaches a Lost Stage only along a drawn edge, a required Stage Field or an unmet
Stage Condition can block the move, and a Terminal Stage cannot be left, so a
Lost deal can never come back. A deleted deal drops out of every report, so
nobody can say how many deals were lost or why.

## Decision

**Losing and reopening skip the Stage gate, and they are the only way into and
out of a Lost Stage.**

- `mark_opportunity_lost` moves a deal from any open Stage to the flow's Lost
  Stage. No edge, Stage Field or Stage Condition is checked, the way a Return
  skips the gate. Who may do it is who may move the Stage today. No new role.
- Reopen puts the deal back on the Stage it was lost from and skips the gate the
  same way. "A terminal Stage cannot be left" stays for normal moves; a Won
  Terminal Stage is not affected.
- Losing records the reason and the Stage it came from, writes the history,
  closes the Stage Visit and tells the Purchase Request chat. It cancels nothing.

## Consequences

- A dead deal can always be closed, even when a Stage Field is required.
- Lost deals stay in reports, with a reason.
- Two functions are the whole door. Anything that wants to lose or reopen a deal
  calls them; nothing else writes a Lost Stage by hand.
