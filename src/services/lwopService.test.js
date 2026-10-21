import { beforeEach, describe, expect, it } from "vitest"
import { lwopService } from "./lwopService"
import { db } from "@/test/db/store"
import { makeEmployee, makeHrEmployee, makeHead, makeLwopLeave, makeOffsetLeave } from "@/test/factories"
import { stubLwopLeaveDecisionRpcs } from "@/test/stubs/leaveDecisionRpc"
import { waitForNetworkIdle } from "@/test/network"
import { stubEdgeFunction } from "@/test/msw/server"
import { manilaToday } from "@/lib/manilaDate"

/**
 * LWOP is a record, not an entitlement: no path in this service may read or write a balance.
 * Every test that touches an employee row checks the balances are exactly as seeded.
 */
describe("lwopService", () => {
  let employee
  let hr
  let pushed

  const balances = (id) => {
    const e = db.rows("employees").find((row) => row.id === id)
    return { sil: e.sil_hours_balance, offset: e.offset_hours_balance }
  }

  beforeEach(() => {
    employee = makeEmployee({ name: "Ana Reyes", sil_hours_balance: 0, offset_hours_balance: 0, employment_status: "Probationary" })
    hr = makeHrEmployee({ name: "HR Officer" })
    stubLwopLeaveDecisionRpcs()
    pushed = []
    stubEdgeFunction("send-push", (body) => {
      pushed.push(body)
      return { success: true }
    })
  })

  describe("applying", () => {
    it("files a single day with no balance at all (and an ineligible status)", async () => {
      const row = await lwopService.applyLwopLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: "09:00",
        endTime: "17:00",
        reason: "Family matter",
        employeeName: "Ana Reyes",
      })

      expect(row).toMatchObject({ status: "PENDING", hours: 7, reason: "Family matter" })
      expect(balances(employee.id)).toEqual({ sil: 0, offset: 0 })
      expect(await lwopService.getMyLwopLeaves(employee.id)).toHaveLength(1)
    })

    it("files a range as one row per day under a shared group", async () => {
      const rows = await lwopService.applyLwopLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-10", hours: 8 },
          { date: "2026-03-11", hours: 8 },
        ],
        reason: "Away",
        employeeName: "Ana Reyes",
      })

      expect(rows).toHaveLength(2)
      expect(new Set(rows.map((r) => r.leave_group_id)).size).toBe(1)
      expect(balances(employee.id)).toEqual({ sil: 0, offset: 0 })
    })

    it("routes to the head when one is given", async () => {
      const head = makeHead({ name: "Head" })
      const row = await lwopService.applyLwopLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: "09:00",
        endTime: "17:00",
        reason: "Family matter",
        headId: head.id,
      })
      expect(row).toMatchObject({ head_id: head.id, head_status: "PENDING" })
    })

    it("refuses a window that overlaps another of the employee's applications that day", async () => {
      makeOffsetLeave({ employee_id: employee.id, date: "2026-03-10", startTime: "09:00", endTime: "13:00" })

      await expect(
        lwopService.applyLwopLeave({
          employeeId: employee.id,
          date: "2026-03-10",
          startTime: "11:00",
          endTime: "15:00",
          reason: "Clash",
        }),
      ).rejects.toThrow("overlaps with an existing application")
      expect(await lwopService.getMyLwopLeaves(employee.id)).toEqual([])
    })

    it("refuses a range day that already has another application, and an earlier LWOP counts", async () => {
      makeLwopLeave({ employee_id: employee.id, date: "2026-03-11" })

      await expect(
        lwopService.applyLwopLeaveRange({
          employeeId: employee.id,
          days: [
            { date: "2026-03-10", hours: 8 },
            { date: "2026-03-11", hours: 8 },
          ],
          reason: "Away",
        }),
      ).rejects.toThrow("An application already exists on 2026-03-11.")
    })

    it("notifies HR and writes an LWOP_LEAVE audit line", async () => {
      await lwopService.applyLwopLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: "09:00",
        endTime: "17:00",
        reason: "Family matter",
        employeeName: "Ana Reyes",
      })
      await waitForNetworkIdle()

      const audit = db.rows("system_audit_logs").find((e) => e.metadata?.event === "LWOP_LEAVE_APPLIED")
      expect(audit.entity_type).toBe("LWOP_LEAVE")
      expect(pushed.find((n) => n.type === "LWOP_LEAVE_REQUEST")?.recipient_id).toBe(hr.id)
    })
  })

  describe("deciding", () => {
    it("approves a group, stamps HR, notifies the employee and leaves balances alone", async () => {
      const leave = makeLwopLeave({ employee_id: employee.id })

      const rows = await lwopService.handleLwopLeaveDecision({ groupId: leave.leave_group_id, status: "APPROVED", hrId: hr.id })
      await waitForNetworkIdle()

      expect(rows[0]).toMatchObject({ status: "APPROVED", hr_processed_by: hr.id })
      expect(rows[0].hr_processed_at).toBeTruthy()
      expect(balances(employee.id)).toEqual({ sil: 0, offset: 0 })
      expect(pushed.some((n) => n.type === "LWOP_LEAVE_DECISION" && n.recipient_id === employee.id)).toBe(true)
      expect(db.rows("system_audit_logs").some((e) => e.entity_type === "LWOP_LEAVE" && e.metadata?.event === "LWOP_LEAVE_DECISION")).toBe(true)
    })

    it("refuses a group that is no longer pending", async () => {
      const leave = makeLwopLeave({ employee_id: employee.id, status: "APPROVED" })
      await expect(
        lwopService.handleLwopLeaveDecision({ groupId: leave.leave_group_id, status: "REJECTED", hrId: hr.id }),
      ).rejects.toThrow("already been decided")
    })

    it("refuses while the head stage is not cleared, and allows it after an HR override", async () => {
      const head = makeHead({ name: "Head" })
      const leave = makeLwopLeave({ employee_id: employee.id, head_id: head.id, head_status: "PENDING" })

      await expect(
        lwopService.handleLwopLeaveDecision({ groupId: leave.leave_group_id, status: "APPROVED", hrId: hr.id }),
      ).rejects.toThrow("department head has not approved")

      db.internal.rowsOf("lwop_leaves").find((r) => r.id === leave.id).hr_override = true
      const rows = await lwopService.handleLwopLeaveDecision({ groupId: leave.leave_group_id, status: "APPROVED", hrId: hr.id })
      expect(rows[0].status).toBe("APPROVED")
    })

    it("undo returns the whole group to pending and clears the HR stamps", async () => {
      const groupId = crypto.randomUUID()
      makeLwopLeave({ employee_id: employee.id, date: "2026-03-10", leave_group_id: groupId })
      makeLwopLeave({ employee_id: employee.id, date: "2026-03-11", leave_group_id: groupId })
      await lwopService.handleLwopLeaveDecision({ groupId, status: "APPROVED", hrId: hr.id })

      const rows = await lwopService.undoLwopLeaveDecision({ groupId, hrId: hr.id })
      await waitForNetworkIdle()

      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(row).toMatchObject({ status: "PENDING", hr_processed_by: null, hr_processed_at: null, approval_hash: null })
      }
      expect(balances(employee.id)).toEqual({ sil: 0, offset: 0 })
      expect(db.rows("system_audit_logs").some((e) => e.metadata?.event === "LWOP_LEAVE_DECISION_UNDONE")).toBe(true)
    })

    it("lists pending LWOP for HR only once the head stage has cleared", async () => {
      const head = makeHead({ name: "Head" })
      makeLwopLeave({ employee_id: employee.id, head_id: head.id, head_status: "PENDING" })
      const cleared = makeLwopLeave({ employee_id: employee.id, date: "2026-03-12" })

      const pending = await lwopService.getAllPendingLwopLeaves()
      expect(pending.map((r) => r.id)).toEqual([cleared.id])
      expect(await lwopService.getAllLwopLeaves()).toHaveLength(2)
    })
  })

  describe("withdrawing", () => {
    it("withdraws a pending group and tells HR", async () => {
      const leave = makeLwopLeave({ employee_id: employee.id })

      const rows = await lwopService.cancelMyLwopLeave({ leaveId: leave.id, employeeId: employee.id })
      await waitForNetworkIdle()

      expect(rows[0].status).toBe("CANCELLED")
      expect(db.rows("notifications").some((n) => n.type === "LWOP_LEAVE_CANCELLED")).toBe(true)
      expect(db.rows("system_audit_logs").some((e) => e.metadata?.event === "LWOP_LEAVE_CANCELLED")).toBe(true)
      expect(balances(employee.id)).toEqual({ sil: 0, offset: 0 })
    })

    it("withdraws a pending group even when its dates are long past", async () => {
      const leave = makeLwopLeave({ employee_id: employee.id, date: "2020-01-06" })
      const rows = await lwopService.cancelMyLwopLeave({ leaveId: leave.id, employeeId: employee.id })
      expect(rows[0].status).toBe("CANCELLED")
    })

    it("withdraws an approved group that starts today (Manila)", async () => {
      const leave = makeLwopLeave({ employee_id: employee.id, status: "APPROVED", date: manilaToday() })
      const rows = await lwopService.cancelMyLwopLeave({ leaveId: leave.id, employeeId: employee.id })
      expect(rows[0].status).toBe("CANCELLED")
    })

    it("refuses an approved group whose first date has passed", async () => {
      const leave = makeLwopLeave({ employee_id: employee.id, status: "APPROVED", date: "2020-01-06" })
      await expect(lwopService.cancelMyLwopLeave({ leaveId: leave.id, employeeId: employee.id })).rejects.toThrow(
        "has already been taken",
      )
    })

    it("refuses someone else's LWOP", async () => {
      const leave = makeLwopLeave({ employee_id: employee.id })
      const other = makeEmployee({ name: "Other" })
      await expect(lwopService.cancelMyLwopLeave({ leaveId: leave.id, employeeId: other.id })).rejects.toThrow("Unauthorized")
    })
  })
})
