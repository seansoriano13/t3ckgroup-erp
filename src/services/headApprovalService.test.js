import { beforeEach, describe, expect, it } from "vitest"
import { assertHeadCleared, decideHeadApproval, hrOverrideApprove } from "./headApprovalService"
import { offsetService } from "./offsetService"
import { silService } from "./silService"
import {
  makeEmployee,
  makeHead,
  makeHrEmployee,
  makeOffsetLeave,
  makeOvertimeRequest,
  makeSilLeave,
} from "@/test/factories"
import { db } from "@/test/db/store"
import { stubOvertimeDecisionRpcs } from "@/test/stubs/overtimeRpc"
import { waitForNetworkIdle } from "@/test/network"

beforeEach(() => {
  stubOvertimeDecisionRpcs()
})

/**
 * The department-head approval stage (issue #137): a request must clear the
 * routed head (head_status='APPROVED') before HR's own decision can approve
 * it, unless HR explicitly overrides. These tests cover the shared gate
 * (assertHeadCleared), the two new service entry points, and their wiring
 * into the existing HR decision handlers.
 */
describe("headApprovalService", () => {
  describe("assertHeadCleared", () => {
    it("throws for a missing row", () => {
      expect(() => assertHeadCleared(null)).toThrow(/not found/)
    })

    it("allows a row with no head_status at all (legacy/pre-stage rows)", () => {
      expect(() => assertHeadCleared({})).not.toThrow()
    })

    it("allows an APPROVED head_status", () => {
      expect(() => assertHeadCleared({ head_status: "APPROVED" })).not.toThrow()
    })

    it("blocks a PENDING head_status", () => {
      expect(() => assertHeadCleared({ head_status: "PENDING" })).toThrow(/head has not approved/)
    })

    it("blocks a REJECTED head_status", () => {
      expect(() => assertHeadCleared({ head_status: "REJECTED" })).toThrow(/head has not approved/)
    })

    it("lets an hr_override through even when the head hasn't cleared it", () => {
      expect(() =>
        assertHeadCleared({ head_status: "PENDING", hr_override: true }),
      ).not.toThrow()
    })
  })

  describe("decideHeadApproval", () => {
    it("records the head's decision on every row in the group and stamps head_decided_at", async () => {
      const head = makeHead({ signature_path: "sigs/head.png" })
      const leave = makeOffsetLeave({ head_status: "PENDING" })

      const [updated] = await decideHeadApproval({
        table: "offset_leaves",
        matchColumn: "leave_group_id",
        matchValue: leave.leave_group_id,
        headId: head.id,
        status: "APPROVED",
        headNote: "Looks fine",
      })

      expect(updated.head_status).toBe("APPROVED")
      expect(updated.head_note).toBe("Looks fine")
      expect(updated.head_id).toBe(head.id)
      expect(updated.head_signature_version).toBe("sigs/head.png")
      expect(updated.head_decided_at).toBeTruthy()
    })

    it("notifies the employee of the head's decision", async () => {
      const head = makeHead()
      const leave = makeSilLeave({ head_status: "PENDING" })

      await decideHeadApproval({
        table: "sil_leaves",
        matchColumn: "leave_group_id",
        matchValue: leave.leave_group_id,
        headId: head.id,
        status: "REJECTED",
      })
      await waitForNetworkIdle()

      const notifications = db.internal.rowsOf("notifications")
      const mine = notifications.find((n) => n.recipient_id === leave.employee_id)
      expect(mine).toBeTruthy()
      expect(mine.type).toBe("SIL_LEAVE_HEAD_DECISION")
    })

    it("rejects an unsupported table", async () => {
      await expect(
        decideHeadApproval({ table: "not_a_real_table", matchColumn: "id", matchValue: "x", status: "APPROVED" }),
      ).rejects.toThrow(/Unsupported table/)
    })

    it("rejects a PENDING status (the head can only approve or reject)", async () => {
      const leave = makeOffsetLeave({ head_status: "PENDING" })
      await expect(
        decideHeadApproval({
          table: "offset_leaves",
          matchColumn: "leave_group_id",
          matchValue: leave.leave_group_id,
          status: "PENDING",
        }),
      ).rejects.toThrow(/head status must be/)
    })
  })

  describe("hrOverrideApprove", () => {
    it("sets hr_override without touching head_status", async () => {
      const leave = makeOffsetLeave({ head_status: "PENDING" })
      const hr = makeHrEmployee()

      const [updated] = await hrOverrideApprove({
        table: "offset_leaves",
        matchColumn: "leave_group_id",
        matchValue: leave.leave_group_id,
        hrId: hr.id,
        reason: "Head is on leave",
      })

      expect(updated.hr_override).toBe(true)
      expect(updated.head_status).toBe("PENDING")
    })
  })

  describe("gating on the existing HR decision handlers", () => {
    it("handleOffsetLeaveDecision refuses to approve while head_status is PENDING", async () => {
      const employee = makeEmployee({ offset_hours_balance: 40 })
      const leave = makeOffsetLeave({ employee_id: employee.id, head_status: "PENDING", hours: 8 })
      const hr = makeHrEmployee()

      await expect(
        offsetService.handleOffsetLeaveDecision({
          groupId: leave.leave_group_id,
          status: "APPROVED",
          hrId: hr.id,
        }),
      ).rejects.toThrow(/head has not approved/)
    })

    it("handleOffsetLeaveDecision approves once head_status is APPROVED", async () => {
      const employee = makeEmployee({ offset_hours_balance: 40 })
      const leave = makeOffsetLeave({ employee_id: employee.id, head_status: "APPROVED", hours: 8 })
      const hr = makeHrEmployee()

      const [updated] = await offsetService.handleOffsetLeaveDecision({
        groupId: leave.leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })
      expect(updated.status).toBe("APPROVED")
    })

    it("handleOffsetLeaveDecision approves a head-pending row when hr_override is set", async () => {
      const employee = makeEmployee({ offset_hours_balance: 40 })
      const leave = makeOffsetLeave({
        employee_id: employee.id,
        head_status: "PENDING",
        hr_override: true,
        hours: 8,
      })
      const hr = makeHrEmployee()

      const [updated] = await offsetService.handleOffsetLeaveDecision({
        groupId: leave.leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })
      expect(updated.status).toBe("APPROVED")
    })

    it("handleOffsetLeaveDecision does not gate a REJECTED HR decision on head_status", async () => {
      const leave = makeOffsetLeave({ head_status: "PENDING" })
      const hr = makeHrEmployee()

      const [updated] = await offsetService.handleOffsetLeaveDecision({
        groupId: leave.leave_group_id,
        status: "REJECTED",
        hrId: hr.id,
      })
      expect(updated.status).toBe("REJECTED")
    })

    it("handleSilLeaveDecision refuses to approve while head_status is PENDING", async () => {
      const employee = makeEmployee({ sil_hours_balance: 40 })
      const leave = makeSilLeave({ employee_id: employee.id, head_status: "PENDING", hours: 8 })
      const hr = makeHrEmployee()

      await expect(
        silService.handleSilLeaveDecision({
          groupId: leave.leave_group_id,
          status: "APPROVED",
          hrId: hr.id,
        }),
      ).rejects.toThrow(/head has not approved/)
    })

    it("handleOvertimeDecision refuses to approve while head_status is PENDING", async () => {
      const employee = makeEmployee()
      const request = makeOvertimeRequest({ employee_id: employee.id, head_status: "PENDING", hours: 4 })
      const hr = makeHrEmployee()

      await expect(
        offsetService.handleOvertimeDecision({
          requestId: request.id,
          status: "APPROVED_PAID",
          hrId: hr.id,
        }),
      ).rejects.toThrow(/head has not approved/)
    })

    it("handleOvertimeDecision does not gate a REJECTED decision on head_status", async () => {
      const request = makeOvertimeRequest({ head_status: "PENDING", hours: 4 })
      const hr = makeHrEmployee()

      const updated = await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "REJECTED",
        hrId: hr.id,
      })
      expect(updated.status).toBe("REJECTED")
    })
  })
})
