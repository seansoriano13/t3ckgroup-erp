import { describe, expect, it } from "vitest";
import { isPushNotificationType, PUSH_NOTIFICATION_TYPES } from "./pushNotificationTypes";

/**
 * Seam B — the risk here is over-notifying, so both directions are asserted:
 * exactly the four event categories push, and every other type in active
 * use stays in-app only.
 */
describe("isPushNotificationType", () => {
  it.each([
    "TASK_MENTION",
    "GROUP_TASK_MENTION",
    "OPPORTUNITY_MENTION",
    "TASK_ASSIGNED",
    "GROUP_ASSIGNED",
    "TASK_GRADED",
    "TASK_REJECTED",
    "TASK_VERIFIED",
    "TASK_APPROVED_BY_HEAD",
    "SIL_LEAVE_HEAD_DECISION",
    "OFFSET_LEAVE_HEAD_DECISION",
    "OVERTIME_HEAD_DECISION",
    "UNDERTIME_HEAD_DECISION",
    "SIL_LEAVE_DECISION",
    "OFFSET_LEAVE_DECISION",
    "OVERTIME_DECISION",
    "UNDERTIME_DECISION",
    "TASK_AWAITING_APPROVAL",
    "GROUP_TASK_READY_FOR_HR",
    "SIL_LEAVE_REQUEST",
    "LWOP_LEAVE_REQUEST",
    "LWOP_LEAVE_DECISION",
    "LWOP_LEAVE_HEAD_DECISION",
    "OFFSET_LEAVE_REQUEST",
    "OVERTIME_REQUEST",
    "UNDERTIME_REQUEST",
  ])("%s pushes", (type) => {
    expect(isPushNotificationType(type)).toBe(true);
  });

  it.each([
    "NEW_TASK_SUBMITTED",
    "TASK_COMPLETED",
    "GROUP_MEMBER_DONE",
    "GROUP_TASK_COMMENT",
    "OPPORTUNITY_REGISTERED",
    "OPPORTUNITY_STAGE_CHANGED",
    "OPPORTUNITY_PROCUREMENT_REQUESTED",
    "OPPORTUNITY_PROCUREMENT_RESOLVED",
    "PROCUREMENT_TASK_DEAL_LOST",
    "OPPORTUNITY_DELETED",
    "SIL_LEAVE_CANCELLED",
    "TASK_REACTION",
    "SYSTEM",
    "SOMETHING_NOBODY_HAS_INVENTED_YET",
  ])("%s stays in-app only", (type) => {
    expect(isPushNotificationType(type)).toBe(false);
  });

  it("has no duplicate entries hiding a typo", () => {
    expect(PUSH_NOTIFICATION_TYPES.size).toBe([...PUSH_NOTIFICATION_TYPES].length);
  });
});
