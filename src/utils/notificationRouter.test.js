// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleNotificationRoute } from "./notificationRouter"

/**
 * Where a notification click lands depends on the reader's role: the same
 * "task approved" notification takes a head to the approvals queue and an
 * ordinary employee to their own task list. Getting this wrong drops people on
 * a page they have no permission to see.
 */
describe("handleNotificationRoute", () => {
  let navigate
  let onClose
  let dispatched

  beforeEach(() => {
    navigate = vi.fn()
    onClose = vi.fn()
    dispatched = []
    vi.spyOn(window, "dispatchEvent").mockImplementation((event) => {
      dispatched.push({ type: event.type, detail: event.detail })
      return true
    })
  })

  const employee = { isHr: false, isHead: false, isSuperAdmin: false }
  const head = { isHead: true }
  const hr = { isHr: true }
  const superAdmin = { isSuperAdmin: true }

  describe("task notifications", () => {
    it("sends an ordinary employee to their own task list", () => {
      handleNotificationRoute(
        { type: "TASK_APPROVED", reference_id: "task-1" },
        employee,
        navigate,
        onClose,
      )

      expect(navigate).toHaveBeenCalledWith("/tasks", { state: { openTaskId: "task-1" } })
    })

    it("sends a head to the approvals queue", () => {
      handleNotificationRoute(
        { type: "TASK_SUBMITTED", reference_id: "task-2" },
        head,
        navigate,
        onClose,
      )

      expect(navigate).toHaveBeenCalledWith("/approvals/tasks", {
        state: { openTaskId: "task-2" },
      })
    })

    it("sends a super admin to the approvals queue", () => {
      handleNotificationRoute(
        { type: "TASK_SUBMITTED", reference_id: "task-3" },
        superAdmin,
        navigate,
        onClose,
      )

      expect(navigate).toHaveBeenCalledWith("/approvals/tasks", {
        state: { openTaskId: "task-3" },
      })
    })

    it("sends HR to verification", () => {
      handleNotificationRoute(
        { type: "TASK_SUBMITTED", reference_id: "task-4" },
        hr,
        navigate,
        onClose,
      )

      expect(navigate).toHaveBeenCalledWith("/approvals/hr-verification", {
        state: { openTaskId: "task-4" },
      })
    })

    it("routes an HR user who is also a head to verification for a head-approved task", () => {
      // The head branch would otherwise swallow it and leave the task
      // unverified in HR's queue.
      handleNotificationRoute(
        { type: "TASK_APPROVED_BY_HEAD", reference_id: "task-5" },
        { isHr: true, isHead: true },
        navigate,
        onClose,
      )

      expect(navigate).toHaveBeenCalledWith("/approvals/hr-verification", {
        state: { openTaskId: "task-5" },
      })
    })

    it("accepts the snake_case role flags the database returns", () => {
      handleNotificationRoute(
        { type: "TASK_SUBMITTED", reference_id: "task-6" },
        { is_head: true },
        navigate,
        onClose,
      )

      expect(navigate).toHaveBeenCalledWith("/approvals/tasks", {
        state: { openTaskId: "task-6" },
      })
    })
  })

  describe("group notifications", () => {
    it("opens the chat modal for a group comment", () => {
      handleNotificationRoute(
        { type: "GROUP_TASK_COMMENT", reference_id: "ct-1" },
        employee,
        navigate,
        onClose,
      )

      expect(navigate).toHaveBeenCalledWith("/group-tasks")
      expect(dispatched).toEqual([
        {
          type: "OPEN_CHAT_MODAL",
          detail: { entityId: "ct-1", entityType: "GROUP_TASK" },
        },
      ])
    })

    it("opens the task details for an assignment", () => {
      handleNotificationRoute(
        { type: "GROUP_ASSIGNED", reference_id: "ct-2" },
        employee,
        navigate,
        onClose,
      )

      expect(dispatched).toEqual([
        { type: "OPEN_ENTITY_DETAILS", detail: { id: "ct-2", type: "GROUP_TASK" } },
      ])
    })

    it("opens the task details when a member finishes or HR is needed", () => {
      handleNotificationRoute(
        { type: "GROUP_MEMBER_DONE", reference_id: "ct-3" },
        employee,
        navigate,
        onClose,
      )
      handleNotificationRoute(
        { type: "GROUP_TASK_READY_FOR_HR", reference_id: "ct-4" },
        hr,
        navigate,
        onClose,
      )

      expect(dispatched.map((e) => e.detail.id)).toEqual(["ct-3", "ct-4"])
    })
  })

  describe("opportunity notifications", () => {
    it("opens the opportunity on the pipeline page", () => {
      handleNotificationRoute(
        { type: "OPPORTUNITY_STAGE_CHANGED", reference_id: "opp-1" },
        employee,
        navigate,
        onClose,
      )

      expect(navigate).toHaveBeenCalledWith("/sors", {
        state: { openOpportunityId: "opp-1" },
      })
    })

    it("opens the deal a Stage Participant was just called into", () => {
      // ADR 0021: a participant gets no register row, so this notification is
      // their only route in. It must NOT navigate to /sors — that page's
      // deep-link fetch is getOpportunityById, which RLS gives them no row
      // for, so the modal would never open and the click would look dead.
      const dispatch = vi.spyOn(window, "dispatchEvent")

      handleNotificationRoute(
        { type: "SOR_STAGE_PARTICIPANT_ADDED", reference_id: "opp-9" },
        employee,
        navigate,
        onClose,
      )

      expect(navigate).not.toHaveBeenCalled()
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "OPEN_ENTITY_DETAILS",
          detail: { id: "opp-9", type: "OPPORTUNITY" },
        }),
      )
      dispatch.mockRestore()
    })

    it("sends procurement notifications to the deal, not to purchasing's task", () => {
      // The naming is load-bearing. The branch above this one is
      // `type.includes("TASK")`, so calling these PROCUREMENT_TASK_* would
      // route sales into the task pages instead — silently, since both
      // branches navigate somewhere plausible. Sales' next move is finishing
      // the quotation, which happens on the SOR.
      for (const type of [
        "OPPORTUNITY_PROCUREMENT_REQUESTED",
        "OPPORTUNITY_PROCUREMENT_RESOLVED",
      ]) {
        navigate.mockClear()
        handleNotificationRoute({ type, reference_id: "opp-9" }, employee, navigate, onClose)

        expect(navigate).toHaveBeenCalledWith("/sors", {
          state: { openOpportunityId: "opp-9" },
        })
      }
    })

    it("keeps purchasing's own warning on the task pages", () => {
      // The buyer's open requisition is the thing they need to look at, so
      // this one keeps the TASK substring deliberately.
      handleNotificationRoute(
        { type: "PROCUREMENT_TASK_DEAL_LOST", reference_id: "task-77" },
        employee,
        navigate,
        onClose,
      )

      expect(navigate).toHaveBeenCalledWith("/tasks", {
        state: { openTaskId: "task-77" },
      })
    })
  })

  describe("notifications with nowhere to go", () => {
    it("closes the drawer without navigating for an unrecognised type", () => {
      handleNotificationRoute(
        { type: "SIL_LEAVE_REQUEST", reference_id: "leave-1" },
        hr,
        navigate,
        onClose,
      )

      expect(navigate).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it("leaves the drawer open when the notification carries no reference", () => {
      // Known asymmetry: the early return skips onClose(), so a
      // reference-less notification click does nothing visible.
      handleNotificationRoute({ type: "TASK_SUBMITTED" }, head, navigate, onClose)

      expect(navigate).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  it("closes the drawer after every successful route", () => {
    handleNotificationRoute(
      { type: "TASK_SUBMITTED", reference_id: "task-9" },
      head,
      navigate,
      onClose,
    )

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
