# ADR 0039 — A date means the date in Manila

## Status
Accepted — supersedes the UTC comparison in ADR 0015.

## Context

The office is in Manila (UTC+8), but much of the code turned a date into text
with `toISOString()`, which reads it in UTC. Between midnight and 8 AM Manila
time that is still yesterday. It put the wrong day in the leave calendar's
"+N more" popup and in the default registration date of a new SOR. ADR 0015
went further and chose UTC on purpose, so the withdraw button would agree with
the database's `CURRENT_DATE`. The result was a rule that stayed one day
lenient every morning.

## Decision

Every "what day is it" question is answered in Asia/Manila, on both sides:

- **Browser:** `date-fns` with `@date-fns/tz`, through one small shared module
  that fixes the zone to Asia/Manila. Code does not build date strings from
  `toISOString()`, and a lint rule stops new code from doing so.
- **Database:** `(now() AT TIME ZONE 'Asia/Manila')::date` replaces
  `CURRENT_DATE` wherever a rule depends on today's date, starting with the
  leave withdrawal cutoff from ADR 0015.

Existing date code moves to the shared module when it is next touched. Code
that is proven to give the wrong day is fixed now.

## Considered Options

- **Native `Intl` with `timeZone: 'Asia/Manila'` and no library.** Rejected:
  it can format a date in Manila but cannot do date arithmetic there (start of
  week, add days, month grids), and that arithmetic is most of what the
  Calendar needs.
- **Keep UTC and accept the morning gap.** Rejected: HR did not know the
  withdrawal rule bent every morning, and a calendar cannot show the wrong day
  for eight hours.
