/**
 * Derives the stage an employee-facing request (SIL, Offset, Overtime or
 * Undertime) has reached, from columns already on the row — never stored,
 * always computed on read (issue #158, #160).
 *
 * The ladder is: SUBMITTED -> WAITING_ON_HEAD -> WITH_HR -> DECIDED ->
 * PRINTED, but a request can also terminate early as DECIDED without ever
 * reaching HR (withdrawn, or declined by the department head) — those are
 * the "awkward" combinations the derivation has to get right.
 */

const APPROVED_STATUSES = ['APPROVED', 'APPROVED_OFFSET', 'APPROVED_PAID'];

export function deriveRequestStage(row) {
  const status = row.status;
  const headStatus = row.head_status ?? 'APPROVED';
  const hrOverride = !!row.hr_override;
  const headName = row.head?.name ?? null;

  if (status === 'CANCELLED') {
    return { key: 'DECIDED', tone: 'neutral', label: 'Withdrawn', waitingOn: null, note: null };
  }

  if (status === 'REJECTED') {
    return { key: 'DECIDED', tone: 'negative', label: 'Declined by HR', waitingOn: null, note: row.hr_notes || null };
  }

  if (APPROVED_STATUSES.includes(status)) {
    if (row.printed_at) {
      return { key: 'PRINTED', tone: 'positive', label: 'Printed', waitingOn: null, note: null };
    }
    return { key: 'DECIDED', tone: 'positive', label: 'Approved', waitingOn: null, note: null };
  }

  // Anything else (PENDING, or a row predating a status this function
  // doesn't recognise) is still moving through the head/HR stages.
  if (hrOverride) {
    return { key: 'WITH_HR', tone: 'progress', label: 'With HR', waitingOn: null, note: null };
  }

  if (headStatus === 'REJECTED') {
    return { key: 'DECIDED', tone: 'negative', label: 'Declined by head', waitingOn: null, note: row.head_note || null };
  }

  if (headStatus === 'PENDING') {
    if (row.head_id) {
      return {
        key: 'WAITING_ON_HEAD',
        tone: 'progress',
        label: headName ? `Waiting on ${headName}` : 'Waiting on department head',
        waitingOn: headName,
        note: null,
      };
    }
    return { key: 'SUBMITTED', tone: 'progress', label: 'Submitted', waitingOn: null, note: null };
  }

  // headStatus === 'APPROVED'
  return { key: 'WITH_HR', tone: 'progress', label: 'With HR', waitingOn: null, note: null };
}
