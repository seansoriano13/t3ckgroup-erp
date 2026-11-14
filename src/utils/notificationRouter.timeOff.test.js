// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { handleNotificationRoute } from "./notificationRouter"

/** #1015: leave, offset, overtime and undertime notifications open the request. */
describe("time-off notification targets", () => {
  const click = (type, reference_id) => {
    const navigate = vi.fn()
    handleNotificationRoute({ type, reference_id }, { isHead: true }, navigate, vi.fn())
    return navigate
  }

  it.each(["SIL_LEAVE_REQUEST", "OFFSET_LEAVE_REQUEST", "OVERTIME_REQUEST", "UNDERTIME_REQUEST"])(
    "%s opens the request in the Approval Center",
    (type) => {
      expect(click(type, "abc-1")).toHaveBeenCalledWith("/approvals/leaves?record=abc-1")
    },
  )

  it.each([
    "SIL_LEAVE_DECISION",
    "LWOP_LEAVE_HEAD_DECISION",
    "OFFSET_LEAVE_DECISION",
    "OVERTIME_HEAD_DECISION",
    "UNDERTIME_DECISION",
    "SIL_LEAVE_CANCELLED",
    "LWOP_LEAVE_CANCELLED",
  ])("%s opens the request in My Requests", (type) => {
    expect(click(type, "grp-9")).toHaveBeenCalledWith("/offsets?record=grp-9")
  })
})
