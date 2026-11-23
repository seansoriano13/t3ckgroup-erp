/**
 * Which actions a viewer may take on an Activity (#628). The database enforces the same
 * rules; this only decides what to show, so each action appears only when it is allowed.
 *
 *   edit    applicant, any non-final request, before or after its day (#1194)
 *   resend  applicant, a returned request before it starts
 *   cancel  applicant, any non-final request, before or after its day (#1194)
 *   hrCancel HR / Super Admin, any non-final upcoming request (reason required)
 */
const NON_FINAL = ['PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED'];

export function meetingActions({ status, startsAt, applicantId, viewerId, isHr = false, now = new Date() }) {
  const none = { edit: false, resend: false, cancel: false, hrCancel: false };
  if (!viewerId || !NON_FINAL.includes(status)) return none;
  const started = new Date(startsAt) <= now;
  const mine = applicantId === viewerId;
  // After its day only the person who filed it may act; nobody else gains rights.
  return {
    edit: mine,
    resend: mine && !started && status === 'RETURNED',
    cancel: mine,
    hrCancel: !mine && isHr && !started,
  };
}
