# ADR 0013 — Atomic Decision RPCs for Overtime, Offset and SIL

## Status
Accepted

## Context

Issue #108 (HR-02, HR-07, HR-09) found that approving, undoing, or
withdrawing an overtime request was a client-orchestrated sequence of
separate writes: read the balance, compute a new figure in JavaScript,
update the row, update the balance to that absolute value. Three defects
shared that one cause:

- Two officers deciding two different overtime requests for the same
  employee each computed a new balance from a stale JS-side read, so one
  balance movement could be silently lost.
- Undoing an `APPROVED_OFFSET` decision clamped the deduction at zero
  instead of refusing when the credited hours were already spent elsewhere
  — inventing hours the employee never gave back.
- The undo path cleared the approval hash, HR signature, and credits
  snapshot but forgot `hr_processed_by`, leaving a reverted record that
  still named the officer who had decided it.

Offset (#109) and SIL (#110) leave decisions follow the same
read-compute-write-write shape and are expected to need the same fix. #108
is the first of the three and establishes the pattern the other two follow.

## Decision

**Move each decision into a single Postgres function**, `decide_<type>_*`
and `undo_<type>_decision`, that locks the employee's balance row with
`SELECT ... FOR UPDATE` before reading it, then writes the row and the
balance in the same statement-level transaction. Locking the employee row
before the read is what serializes two concurrent decisions for the same
employee: the second blocks until the first commits, so it always computes
its own change against the balance the first one actually left behind.

Overtime's functions are `decide_overtime_request` and
`undo_overtime_decision` (see the migration
`20260906120000_atomic_overtime_decisions.sql`). Offset (#109) and SIL (#110) added
`decide_offset_leave_decision` / `undo_offset_leave_decision` /
`withdraw_offset_leave` and `decide_sil_leave_decision` /
`undo_sil_leave_decision` / `cancel_sil_leave` following the same shape,
group-atomic over `leave_group_id` since those decisions already act on
every day-row in a range together. Group atomicity is the one thing
overtime never had to solve: each of those functions locks every day-row
sharing the group id, in id order so two decisions cannot deadlock, before
it reads anything off the group.

The leave functions return `jsonb` rather than a row type, because a group
decision has to hand back a set of rows plus the facts the service layer
still needs to write its notification and audit lines — the group's total
hours, its dates, the status it moved from, and for SIL whether the refund
was withheld (see below).

**The approval hash and HR signature are computed inside the function, in
SQL, not in JavaScript beforehand.** The application hash (computed at
apply time, via `crypto.subtle` in `src/utils/formHashes.js`) is unaffected
— nothing concurrent touches it. But the approval hash commits to the
*credits snapshot*, the balance the decision produces, and that value is
only known for certain once the function holds the employee-row lock.
Computing it in JavaScript first — as `stampApproval` did — would risk
hashing a number a concurrent decision could still change before the write
lands.

The SQL side already had everything needed to do this: `pgcrypto`'s
`digest()` and Postgres's `trim_scale()` are exactly what
`verify_form_token` (`supabase/migrations/_archive/0079_...sql`) uses to
recompute the same hash server-side for public verification. The decision
functions reuse that identical formula —
`encode(digest(format('%s|%s|%s|%s', application_hash, status,
COALESCE(hr_processed_by::text, ''), canon_credits), 'sha256'), 'hex')` —
so a hash produced by a decision function and one recomputed by
`verify_form_token` agree byte-for-byte, the same guarantee
`src/utils/formHashes.js`'s `canonicalNumber()` already documents for the
JS side.

**Undoing a decision whose credited hours are already spent refuses
outright, with a message naming both figures, rather than recording a
negative balance.** A negative `offset_hours_balance` /
`sil_hours_balance` is not a value the rest of the app (balance displays,
apply-time checks) is written to expect, so surfacing the conflict as an
error HR must resolve by hand was chosen over quietly letting the balance
go negative. This is a policy call, not a technical constraint — the
acceptance criteria for #108 allow either — and it should carry over to
#109 and #110 for consistency.

**A decision function refuses to re-decide a group that is already
decided.** Overtime's `decide_overtime_request` has no such precondition
because a single row cannot be half-decided; a group can, and without the
check two officers approving the same leave at once would each deduct its
hours. The leave functions therefore require every row in the group to be
`PENDING`, which is the group-level equivalent of the `.eq('status',
'PENDING')` guard #108 added to overtime's withdraw.

**SIL's refund gate moved into the function; the anomaly it records did
not.** A SIL refund is withheld from an employee whose employment status is
no longer SIL-eligible, and that gate has to sit inside the same lock as the
write it guards. But the audit line it produces is the only signal HR gets
that a balance needs correcting by hand, and it belongs with every other SIL
audit line, in the service layer. So `undo_sil_leave_decision` and
`cancel_sil_leave` report `refund_withheld` (with the employment status and
name that explain it) back to the caller, which writes the
`SIL_REFUND_ANOMALY` event — rather than the function swallowing the
decision silently or reaching into the audit table itself.

**`hr_processed_by` is cleared alongside the hash, signature, and snapshot
on every undo path**, matching what `undoOffsetLeaveDecision` and
`undoSilLeaveDecision` already did correctly — overtime's undo was the one
place it had been missed.

## Consequences

- Every decision and undo is one `supabase.rpc()` call from the service
  layer instead of a `.select()` + `.update()` + `.update()` sequence. The
  JS-side service functions (`offsetService.handleOvertimeDecision`,
  `offsetService.undoOvertimeDecision`) now do their notification and audit
  logging off the row the RPC returns, rather than a row fetched
  separately beforehand.
- `stampApproval` / `fetchSignaturePath` in `offsetService.js` remained in use
  for Offset and SIL until #109 and #110 moved those paths onto the same RPC
  pattern. With all three record types on it, `stampApproval` and the
  `generateApprovalHash` it wrapped were removed rather than left as an unused
  alternate path — the approval-hash formula now lives in exactly one place per
  side of the comparison: the decision functions produce it, `verify_form_token`
  recomputes it. `stampApplication` and `generateApplicationHash` stay, since
  the application hash is still computed in the browser at apply time.
- The fake Postgres the test suite runs against (`src/test/db`) does not
  execute SQL — RPC-backed service tests register a `stubRpc()` handler
  that re-implements the function's logic in JavaScript against the same
  in-memory store, the pattern `purchasingService.test.js` already
  established for `sor_raise_procurement_task`. This is what makes the
  concurrent-decision behavior testable at all: two `supabase.rpc()` calls
  fired concurrently still each run their stub's logic to completion before
  the next one starts, since nothing in a synchronous stub body yields
  control mid-computation — the same atomicity a real `FOR UPDATE` lock
  gives in production.
