/**
 * Which actions a viewer may take on a Meeting Request (#628). The database enforces the same
 * rules; this only decides what to show, so each action appears only when it is allowed.
 *
 *   edit    applicant, any non-final request before it starts
 *   resend  applicant, a returned request before it starts
 *   cancel  applicant, any non-final request before it starts
 *   hrCancel HR / Super Admin, any non-final upcoming request (reason required)
 */
const NON_FINAL = ['PENDING_HEAD', 'PENDING_HR', 'RETURNED', 'APPROVED'];

export function meetingActions({ status, startsAt, applicantId, viewerId, isHr = false, now = new Date() }) {
  const none = { edit: false, resend: false, cancel: false, hrCancel: false };
  if (!viewerId || !NON_FINAL.includes(status)) return none;
  if (new Date(startsAt) <= now) return none;
  const mine = applicantId === viewerId;
  return {
    edit: mine,
    resend: mine && status === 'RETURNED',
    cancel: mine,
    hrCancel: !mine && isHr,
  };
}
