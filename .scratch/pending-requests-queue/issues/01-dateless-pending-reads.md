# 01 — Add dateless "pending" reads to the leave/overtime services

**What to build:** `offsetService` and `silService` gain reads that return pending requests — overtime, offset leave, and SIL leave — with no date bounds at all. This is the seam the rest of this feature builds on: today, "pending" is derived by filtering whatever a period-scoped fetch happened to return, which is exactly why a request dated outside the current month goes invisible. The fix is a read whose signature takes no dates, so "pending is not a period view" is a decision visible in the code rather than something each caller has to remember.

Not user-facing on its own — nothing in the UI calls these yet. The existing period-scoped reads (used by the calendar board and Decision History) are untouched; this adds new reads alongside them, it does not replace anything.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `offsetService` exposes a read returning all pending overtime requests, across every date, with no start/end parameters.
- [ ] `offsetService` exposes a read returning all pending offset-leave requests, across every date, with no start/end parameters.
- [ ] `silService` exposes a read returning all pending SIL-leave requests, across every date, with no start/end parameters.
- [ ] A request dated in a different month than the current one is returned by the relevant new read.
- [ ] A request dated in a past month (i.e. an old, never-actioned request) is returned by the relevant new read.
- [ ] A decided (approved/rejected), withdrawn, or cancelled request is NOT returned by any of the new reads.
- [ ] The existing period-scoped reads (`getAllOvertimeRequests`, `getAllOffsetLeaves`, `getAllSilLeaves`, or equivalents) are unchanged in behavior and still take date bounds.
- [ ] Service-tier tests exist against the fake database covering: cross-month visibility, stale/past-month visibility, exclusion of decided/withdrawn/cancelled rows, and that the old period-scoped reads still behave exactly as before.
