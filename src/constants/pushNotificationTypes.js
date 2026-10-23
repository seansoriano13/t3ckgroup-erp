/**
 * Which in-app notification types also push to a closed tab.
 *
 * #166/#168: exactly four kinds of event push — a mention, a task assigned to
 * you, a decision on your own request, and a request awaiting your approval.
 * A push for every one of ~30 notification types trains people to disable it
 * in a week, so this list is deliberately narrow and every other `type`
 * value stays in-app only, by default, with no explicit opt-out needed.
 *
 * This is the single place that decides the split, so a new notification
 * type is in-app-only until someone deliberately adds it here — the safe
 * direction to fail in, since the risk this spec calls out is
 * over-notifying, not under-notifying.
 */
export const PUSH_NOTIFICATION_TYPES = new Set([
  // A mention, across every place the app supports one.
  "TASK_MENTION",
  "GROUP_TASK_MENTION",
  "OPPORTUNITY_MENTION",

  // A task assigned to you.
  "TASK_ASSIGNED",
  "GROUP_ASSIGNED",

  // A decision on your own request — the department head's decision and HR's
  // final one are both a decision on the same request.
  "TASK_GRADED",
  "TASK_REJECTED",
  "TASK_VERIFIED",
  "TASK_APPROVED_BY_HEAD",
  "SIL_LEAVE_HEAD_DECISION",
  "LWOP_LEAVE_HEAD_DECISION",
  "OFFSET_LEAVE_HEAD_DECISION",
  "OVERTIME_HEAD_DECISION",
  "UNDERTIME_HEAD_DECISION",
  "SIL_LEAVE_DECISION",
  "LWOP_LEAVE_DECISION",
  "OFFSET_LEAVE_DECISION",
  "OVERTIME_DECISION",
  "UNDERTIME_DECISION",
  "MEETING_REQUEST_DECISION",
  "MEETING_APPROVED",
  "MEETING_REMINDER",

  // A request awaiting your approval.
  "TASK_AWAITING_APPROVAL",
  "GROUP_TASK_READY_FOR_HR",
  "SIL_LEAVE_REQUEST",
  "LWOP_LEAVE_REQUEST",
  "OFFSET_LEAVE_REQUEST",
  "OVERTIME_REQUEST",
  "UNDERTIME_REQUEST",
  "MEETING_REQUEST",

  // A Follow-up Cadence reminder (issue #204 Part 3) — chasing someone who
  // may not have the portal open, the same reason a request-awaiting-your-
  // approval type pushes.
  "OPPORTUNITY_FOLLOW_UP_DUE",
]);

export function isPushNotificationType(type) {
  return PUSH_NOTIFICATION_TYPES.has(type);
}
