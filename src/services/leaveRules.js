import { deriveHours } from '../utils/time';

/**
 * Business rules shared by every leave-filing path (Offset single-day,
 * Offset range, SIL single-day, SIL range). An audit (issue #91) found each
 * of these enforced in some paths and silently skipped in others — a SIL day
 * filed on a Saturday, a 9.5-hour Offset window billed with no lunch taken
 * out of it, a non-Regular employee spending a SIL balance they were never
 * eligible for. Whichever path is calling, it consults the same functions
 * here, so a future rule change is one edit instead of four.
 */

/** The only employment status SIL accrues against or may be spent from. */
export const SIL_ELIGIBLE_STATUS = 'Regular';

const WEEKEND_MESSAGE = 'Leaves cannot be applied on weekends (Saturday / Sunday)';

/**
 * Weekends aren't a scheduled workday for either leave type, so filing
 * against one is rejected the same way everywhere: Offset or SIL, a single
 * date or one date inside a range. Pass `dateLabel` (the same date, for a
 * range caller checking one day at a time) to name the offending date in the
 * error, matching how the range paths already report every other per-day
 * error.
 */
export function assertNotWeekend(dateStr, dateLabel) {
  const weekday = new Date(dateStr).getUTCDay();
  if (weekday !== 0 && weekday !== 6) return;
  throw new Error(dateLabel ? `${WEEKEND_MESSAGE}: ${dateLabel}.` : `${WEEKEND_MESSAGE}.`);
}

/**
 * A day's leave hours of 5 or more is assumed to span the employee's lunch
 * hour, so it loses 1 hour — the same real, unpaid break regardless of
 * whether the figure came from a start/end window (single-day) or was typed
 * directly for a day inside a range.
 */
export function applyLunchDeduction(hours) {
  return hours >= 5 ? hours - 1 : hours;
}

/**
 * Net leave hours for a start/end window, lunch hour already deducted.
 */
export function deriveLeaveHours(startTime, endTime) {
  return applyLunchDeduction(deriveHours(startTime, endTime, false));
}

/**
 * Undertime hours: the difference between the scheduled ("original") window
 * and what was actually worked ("actual"), each net of its own lunch
 * deduction. Written as two independent deriveLeaveHours calls (rather than
 * one derivation over four times) so a window that crosses the 5-hour lunch
 * threshold on one side but not the other is still deducted correctly on
 * each side before the subtraction, not averaged away.
 */
export function deriveUndertimeHours(original, actual) {
  const originalHours = deriveLeaveHours(original.startTime, original.endTime);
  const actualHours = deriveLeaveHours(actual.startTime, actual.endTime);
  return originalHours - actualHours;
}

/**
 * SIL is a Regular-only benefit end to end: only a Regular employee may file
 * for it or be approved for it. Non-Regular employees (Probationary, OJT)
 * are blocked at the same gate `creditSilRefund` already used one-way (on
 * refund only) — this closes the other direction.
 */
export function assertSilEligible(employmentStatus) {
  if (employmentStatus !== SIL_ELIGIBLE_STATUS) {
    throw new Error('Only Regular employees are eligible for SIL leave.');
  }
}

/**
 * What an employee can actually still commit: the balance minus hours
 * already claimed by their own pending applications (issue #106). Nothing is
 * deducted from the stored balance until HR approves, so without this,
 * checking a new application against the raw balance lets the same hours be
 * promised to several pending requests at once — every one of them passes
 * validation individually, and HR only discovers the conflict when
 * approving the second one throws a balance error nobody was warned about.
 */
export function computeAvailableHours(balance, pendingHours) {
  return parseFloat(balance || 0) - parseFloat(pendingHours || 0);
}

/**
 * Refuses an application that would exceed what's actually available once
 * pending applications are counted, naming both figures so the employee (or
 * HR, filing on their behalf) understands why — not just the raw balance,
 * which may still look sufficient on its own.
 */
export function assertWithinAvailableBalance({ currentBalance, pendingHours, requestedHours, leaveTypeLabel }) {
  const available = computeAvailableHours(currentBalance, pendingHours);
  if (requestedHours > available) {
    throw new Error(
      `Insufficient ${leaveTypeLabel} hours. ${pendingHours} hrs already committed to pending applications, leaving ${available} hrs available.`
    );
  }
}
