import { beforeEach, describe, expect, it } from "vitest"
import { cleanAttachments, offsetService } from "./offsetService"
import { db } from "@/test/db/store"
import { stubOvertimeDecisionRpcs } from "@/test/stubs/overtimeRpc"
import { waitForNetworkIdle } from "@/test/network"
import { getMonthBoundaries } from "@/utils/dateUtils"
import {
  makeEmployee,
  makeHrEmployee,
  makeOffsetLeave,
  makeOvertimeRequest,
} from "@/test/factories"

/**
 * Overtime earns offset hours; offset leave spends them. The invariant that
 * matters is that the two stay in step — no path may credit hours that were
 * never worked or spend hours the employee does not have.
 */
describe("offsetService", () => {
  let employee
  let hr

  beforeEach(() => {
    employee = makeEmployee({ name: "Ana Reyes", offset_hours_balance: 16 })
    hr = makeHrEmployee({ name: "HR Officer" })
    stubOvertimeDecisionRpcs()
  })

  const balanceOf = (id) => db.rows("employees").find((e) => e.id === id).offset_hours_balance

  const findRow = (table, id) => db.internal.rowsOf(table).find((row) => row.id === id)

  describe("applying for overtime", () => {
    it("files a pending request", async () => {
      await offsetService.applyOvertime({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: '09:00', endTime: '13:00',
        reason: "Server migration",
        employeeName: "Ana Reyes",
      })

      const mine = await offsetService.getMyOvertimeRequests(employee.id)
      expect(mine[0]).toMatchObject({
        start_time: "09:00",
        end_time: "13:00",
        hours: 4,
        status: "PENDING",
        reason: "Server migration",
      })
    })

    it("credits nothing until HR decides", async () => {
      await offsetService.applyOvertime({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: '09:00', endTime: '13:00',
        reason: "Server migration",
      })

      expect(balanceOf(employee.id)).toBe(16)
    })

    it("rejects a window that encloses no time", async () => {
      for (const [startTime, endTime] of [
        ["09:00", "09:00"],
        ["", ""],
        ["09:00", ""],
      ]) {
        await expect(
          offsetService.applyOvertime({
            employeeId: employee.id,
            date: "2026-03-10",
            startTime,
            endTime,
            reason: "Work",
          }),
        ).rejects.toThrow("Please enter a valid time window.")
      }
    })

    it("reads a window that crosses midnight as overtime worked into the next day", async () => {
      await offsetService.applyOvertime({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: "22:00",
        endTime: "02:00",
        reason: "Cutover",
      })

      const mine = await offsetService.getMyOvertimeRequests(employee.id)
      expect(mine[0]).toMatchObject({ hours: 4, start_time: "22:00", end_time: "02:00" })
    })

    it("requires a reason", async () => {
      await expect(
        offsetService.applyOvertime({
          employeeId: employee.id,
          date: "2026-03-10",
          startTime: '09:00', endTime: '13:00',
          reason: "",
        }),
      ).rejects.toThrow("Please provide a reason for the overtime request.")
    })
  })

  describe("applying for offset leave", () => {
    it("files a pending application", async () => {
      await offsetService.applyOffsetLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: '09:00', endTime: '17:00',
        reason: "Family matter",
      })

      const mine = await offsetService.getMyOffsetLeaves(employee.id)
      expect(mine[0]).toMatchObject({
        start_time: "09:00",
        end_time: "17:00",
        hours: 7, // 8-hour window minus the 1-hour lunch deduction (issue #91)
        status: "PENDING",
      })
    })

    it("deducts an hour for lunch on a window of 5 hours or more, matching SIL", async () => {
      await offsetService.applyOffsetLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: "07:30", endTime: "18:00",
        reason: "Full day",
      })

      expect((await offsetService.getMyOffsetLeaves(employee.id))[0].hours).toBe(9.5) // 10.5-hour window minus 1 hour for lunch
    })

    it("does not deduct for lunch on a window under 5 hours", async () => {
      await offsetService.applyOffsetLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: "09:00", endTime: "13:00",
        reason: "Half day",
      })

      expect((await offsetService.getMyOffsetLeaves(employee.id))[0].hours).toBe(4)
    })

    it("refuses a Saturday or Sunday", async () => {
      // 2026-03-14 is a Saturday, 2026-03-15 a Sunday.
      for (const date of ["2026-03-14", "2026-03-15"]) {
        await expect(
          offsetService.applyOffsetLeave({
            employeeId: employee.id,
            date,
            startTime: '09:00', endTime: '17:00',
            reason: "Weekend",
          }),
        ).rejects.toThrow(/cannot be applied on weekends/i)
      }
    })

    it("allows a Friday and a Monday", async () => {
      await offsetService.applyOffsetLeave({
        employeeId: employee.id,
        date: "2026-03-13",
        startTime: '09:00', endTime: '13:00',
        reason: "Friday",
      })
      await offsetService.applyOffsetLeave({
        employeeId: employee.id,
        date: "2026-03-16",
        startTime: '09:00', endTime: '13:00',
        reason: "Monday",
      })

      expect(await offsetService.getMyOffsetLeaves(employee.id)).toHaveLength(2)
    })

    it("excludes a leave dated the 1st of the following month from a month filter", async () => {
      await offsetService.applyOffsetLeave({
        employeeId: employee.id,
        date: "2026-03-13",
        startTime: '09:00', endTime: '13:00',
        reason: "Friday",
      })
      // April 1, 2026 is a Wednesday, so it is a valid weekday application.
      await offsetService.applyOffsetLeave({
        employeeId: employee.id,
        date: "2026-04-01",
        startTime: '09:00', endTime: '13:00',
        reason: "Next month",
      })

      const { startDate, endDate } = getMonthBoundaries("2026-03")
      const march = await offsetService.getMyOffsetLeaves(employee.id, startDate, endDate)

      expect(march.map((l) => l.date)).toEqual(["2026-03-13"])
    })

    it("refuses more hours than the employee has banked", async () => {
      await expect(
        offsetService.applyOffsetLeave({
          employeeId: employee.id,
          date: "2026-03-10",
          startTime: '00:00', endTime: '23:59',
          reason: "Long break",
        }),
      ).rejects.toThrow("Insufficient offset hours. 0 hrs already committed to pending applications, leaving 16 hrs available.")
    })

    // Issue #106 (HR-03): every apply path checked the raw balance, and
    // nothing deducted until HR approved — an employee could file the same
    // hours against several pending applications and have every one pass.
    it("refuses a second application once the first has already claimed the balance as pending", async () => {
      const capped = makeEmployee({ name: "Capped Employee", offset_hours_balance: 4 })

      await offsetService.applyOffsetLeave({
        employeeId: capped.id,
        date: "2026-03-10",
        startTime: '09:00', endTime: '13:00', // 4 hrs, exactly the balance
        reason: "First",
      })

      await expect(
        offsetService.applyOffsetLeave({
          employeeId: capped.id,
          date: "2026-03-11",
          startTime: '09:00', endTime: '13:00',
          reason: "Second",
        }),
      ).rejects.toThrow("Insufficient offset hours. 4 hrs already committed to pending applications, leaving 0 hrs available.")

      expect(await offsetService.getMyOffsetLeaves(capped.id)).toHaveLength(1)
      expect(balanceOf(capped.id)).toBe(4)
    })

    it("frees the hours back up for a new application as soon as the pending one is withdrawn", async () => {
      const capped = makeEmployee({ name: "Capped Employee", offset_hours_balance: 4 })

      const first = await offsetService.applyOffsetLeave({
        employeeId: capped.id,
        date: "2026-03-10",
        startTime: '09:00', endTime: '13:00',
        reason: "First",
      })

      await offsetService.withdrawOffsetLeave({ leaveId: first.id, employeeId: capped.id })

      const second = await offsetService.applyOffsetLeave({
        employeeId: capped.id,
        date: "2026-03-11",
        startTime: '09:00', endTime: '13:00',
        reason: "Second, after withdrawing the first",
      })

      expect(second.status).toBe("PENDING")
    })
  })

  describe("HR decisions on overtime", () => {
    it("banks the hours when overtime is approved as offset", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })

      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        hrId: hr.id,
      })

      expect(balanceOf(employee.id)).toBe(20)
    })

    it("banks nothing when overtime is approved as paid", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })

      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_PAID",
        hrId: hr.id,
      })

      expect(balanceOf(employee.id)).toBe(16)
      expect((await offsetService.getMyOvertimeRequests(employee.id))[0].status).toBe(
        "APPROVED_PAID",
      )
    })

    it("banks nothing when overtime is rejected", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })

      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "REJECTED",
        hrNotes: "Not pre-approved",
        hrId: hr.id,
      })

      expect(balanceOf(employee.id)).toBe(16)
    })

    it("tells the employee which kind of approval it was", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })

      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        hrId: hr.id,
      })
      await waitForNetworkIdle()

      expect(db.rows("notifications")[0].message).toContain("Approved as Offset")
    })

    it("defaults approved hours to the requested figure and credits that", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })

      const updated = await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        hrId: hr.id,
      })

      expect(updated.approved_hours).toBe(4)
      expect(balanceOf(employee.id)).toBe(20)
    })

    it("credits the approved hours rather than the requested hours when HR overrides them", async () => {
      // A real TG-12 shows 4hrs struck through and replaced with 3.5.
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })

      const updated = await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        approvedHours: 3.5,
        hrId: hr.id,
      })

      expect(updated.approved_hours).toBe(3.5)
      expect(balanceOf(employee.id)).toBe(19.5)
    })

    it("records approved hours on a paid approval without crediting the balance", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })

      const updated = await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_PAID",
        approvedHours: 3,
        hrId: hr.id,
      })

      expect(updated.approved_hours).toBe(3)
      expect(balanceOf(employee.id)).toBe(16)
    })

    it("refuses a non-positive approved-hours override", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })

      for (const badValue of [0, -1]) {
        await expect(
          offsetService.handleOvertimeDecision({
            requestId: request.id,
            status: "APPROVED_OFFSET",
            approvedHours: badValue,
            hrId: hr.id,
          }),
        ).rejects.toThrow("Approved hours must be greater than zero.")
      }

      expect(balanceOf(employee.id)).toBe(16)
      expect((await offsetService.getMyOvertimeRequests(employee.id))[0].status).toBe("PENDING")
    })

    it("records no approved hours on rejection", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })

      const updated = await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "REJECTED",
        hrId: hr.id,
      })

      expect(updated.approved_hours).toBeNull()
    })

    it("snapshots the balance after the credit lands, not the balance at the moment of approval", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })

      const updated = await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        hrId: hr.id,
      })

      expect(updated.approval_credits_snapshot).toBe(balanceOf(employee.id))
      expect(updated.approval_credits_snapshot).toBe(20)
    })

    it("snapshots null on rejection", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })

      const updated = await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "REJECTED",
        hrId: hr.id,
      })

      expect(updated.approval_credits_snapshot).toBeNull()
    })
  })

  describe("undoing an overtime decision", () => {
    it("takes the banked hours back", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })
      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        hrId: hr.id,
      })

      await offsetService.undoOvertimeDecision({ requestId: request.id, hrId: hr.id })

      expect(balanceOf(employee.id)).toBe(16)
      expect((await offsetService.getMyOvertimeRequests(employee.id))[0].status).toBe("PENDING")
    })

    it("refuses to undo when the credited hours have already been spent, rather than clamping the balance at zero", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '00:00', endTime: '23:59' })
      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        hrId: hr.id,
      })
      // The employee spends everything before HR reverses the approval.
      await setOffsetBalance(employee.id, 0)

      await expect(
        offsetService.undoOvertimeDecision({ requestId: request.id, hrId: hr.id }),
      ).rejects.toThrow(/cannot undo/i)

      // Neither the balance nor the request moved — the refusal happened
      // before either write, not partway through.
      expect(balanceOf(employee.id)).toBe(0)
      expect((await offsetService.getMyOvertimeRequests(employee.id))[0].status).toBe("APPROVED_OFFSET")
    })

    it("does not deduct when undoing a paid approval", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })
      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_PAID",
        hrId: hr.id,
      })

      await offsetService.undoOvertimeDecision({ requestId: request.id, hrId: hr.id })

      expect(balanceOf(employee.id)).toBe(16)
    })

    it("takes back the approved hours, not the requested hours, when they were overridden", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })
      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        approvedHours: 3.5,
        hrId: hr.id,
      })
      expect(balanceOf(employee.id)).toBe(19.5)

      await offsetService.undoOvertimeDecision({ requestId: request.id, hrId: hr.id })

      expect(balanceOf(employee.id)).toBe(16)
    })

    it("falls back to the requested hours when undoing a pre-migration row with no approved hours recorded", async () => {
      // Rows written before this column existed have status APPROVED_OFFSET
      // but a null approved_hours — the fallback this guards against.
      const request = makeOvertimeRequest({
        employee_id: employee.id,
        status: "APPROVED_OFFSET",
        hours: 4,
        approved_hours: null,
      })
      await setOffsetBalance(employee.id, 20) // as if the 4 hrs were already credited

      await offsetService.undoOvertimeDecision({ requestId: request.id, hrId: hr.id })

      expect(balanceOf(employee.id)).toBe(16)
    })

    it("refuses to undo a request that is already pending", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id })

      await expect(
        offsetService.undoOvertimeDecision({ requestId: request.id, hrId: hr.id }),
      ).rejects.toThrow("Request is already pending.")
    })

    it("clears the approval hash, HR signature, and credits snapshot the reverted decision left behind", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })
      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        hrId: hr.id,
      })

      const reverted = await offsetService.undoOvertimeDecision({ requestId: request.id, hrId: hr.id })

      expect(reverted.approval_hash).toBeNull()
      expect(reverted.hr_signature_version).toBeNull()
      expect(reverted.hr_signature_timestamp).toBeNull()
      expect(reverted.approval_credits_snapshot).toBeNull()
    })

    it("clears hr_processed_by, so a reverted request carries no trace of who decided it", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })
      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        hrId: hr.id,
      })
      expect(findRow("overtime_requests", request.id).hr_processed_by).toBe(hr.id)

      const reverted = await offsetService.undoOvertimeDecision({ requestId: request.id, hrId: hr.id })

      expect(reverted.hr_processed_by).toBeNull()
    })

    it("records what the decision used to be in the audit trail", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })
      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        hrId: hr.id,
      })

      await offsetService.undoOvertimeDecision({ requestId: request.id, hrId: hr.id })
      await waitForNetworkIdle()

      const entry = db
        .rows("system_audit_logs")
        .find((e) => e.metadata?.event === "OVERTIME_DECISION_UNDONE")
      expect(entry.metadata.previousStatus).toBe("APPROVED_OFFSET")
      expect(entry.content).toContain("was APPROVED_OFFSET")
    })

    it("does not lose a balance movement when two officers decide two different requests for the same employee at once", async () => {
      const first = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' }) // 4 hrs
      const second = makeOvertimeRequest({ employee_id: employee.id, startTime: '14:00', endTime: '17:00' }) // 3 hrs

      await Promise.all([
        offsetService.handleOvertimeDecision({ requestId: first.id, status: "APPROVED_OFFSET", hrId: hr.id }),
        offsetService.handleOvertimeDecision({ requestId: second.id, status: "APPROVED_OFFSET", hrId: hr.id }),
      ])

      // 16 (starting) + 4 + 3 — neither credit may be overwritten by the other.
      expect(balanceOf(employee.id)).toBe(23)
    })

    it("does not lose a balance movement when an approval and an undo race for the same employee", async () => {
      const alreadyApproved = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' }) // 4 hrs
      await offsetService.handleOvertimeDecision({ requestId: alreadyApproved.id, status: "APPROVED_OFFSET", hrId: hr.id })
      expect(balanceOf(employee.id)).toBe(20)

      const toApprove = makeOvertimeRequest({ employee_id: employee.id, startTime: '14:00', endTime: '17:00' }) // 3 hrs

      await Promise.all([
        offsetService.undoOvertimeDecision({ requestId: alreadyApproved.id, hrId: hr.id }), // -4
        offsetService.handleOvertimeDecision({ requestId: toApprove.id, status: "APPROVED_OFFSET", hrId: hr.id }), // +3
      ])

      // 20 - 4 + 3, regardless of which settled first.
      expect(balanceOf(employee.id)).toBe(19)
    })
  })

  describe("HR decisions on offset leave", () => {
    it("spends the hours when the leave is approved", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })

      await offsetService.handleOffsetLeaveDecision({
        groupId: leave.leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      expect(balanceOf(employee.id)).toBe(8)
    })

    it("refuses to approve a leave the balance can no longer cover", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id, hours: 16 })
      await setOffsetBalance(employee.id, 4)

      await expect(
        offsetService.handleOffsetLeaveDecision({
          groupId: leave.leave_group_id,
          status: "APPROVED",
          hrId: hr.id,
        }),
      ).rejects.toThrow("Cannot approve leave. Employee currently only has 4 hrs balance.")

      expect((await offsetService.getMyOffsetLeaves(employee.id))[0].status).toBe("PENDING")
    })

    it("returns the hours when an approval is undone", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })
      await offsetService.handleOffsetLeaveDecision({
        groupId: leave.leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      await offsetService.undoOffsetLeaveDecision({ groupId: leave.leave_group_id, hrId: hr.id })

      expect(balanceOf(employee.id)).toBe(16)
    })

    it("refuses to undo a leave that is already pending", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id })

      await expect(
        offsetService.undoOffsetLeaveDecision({ groupId: leave.leave_group_id, hrId: hr.id }),
      ).rejects.toThrow("Leave is already pending.")
    })

    it("approves a multi-day range atomically, spending its total hours in one balance update", async () => {
      const group = await offsetService.applyOffsetLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-16", hours: 8 }, // Monday
          { date: "2026-03-17", hours: 4 }, // Tuesday, a half-day
        ],
        reason: "Family trip",
      })

      const updated = await offsetService.handleOffsetLeaveDecision({
        groupId: group[0].leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      expect(updated).toHaveLength(2)
      expect(updated.every((row) => row.status === "APPROVED")).toBe(true)
      expect(balanceOf(employee.id)).toBe(5) // 16 - 7 (8 minus lunch) - 4
    })

    it("leaves every day in the range untouched when the group can't be approved", async () => {
      await setOffsetBalance(employee.id, 24) // enough to submit the range
      const group = await offsetService.applyOffsetLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-16", hours: 8 },
          { date: "2026-03-17", hours: 8 },
          { date: "2026-03-18", hours: 8 },
        ],
        reason: "Long trip",
      })
      // HR reduced the balance after the employee applied.
      await setOffsetBalance(employee.id, 16)

      await expect(
        offsetService.handleOffsetLeaveDecision({
          groupId: group[0].leave_group_id,
          status: "APPROVED",
          hrId: hr.id,
        }),
      ).rejects.toThrow("Cannot approve leave. Employee currently only has 16 hrs balance.")

      const rows = await offsetService.getMyOffsetLeaves(employee.id)
      expect(rows.every((row) => row.status === "PENDING")).toBe(true)
      expect(balanceOf(employee.id)).toBe(16)
    })

    it("rejects every day in the range together", async () => {
      const group = await offsetService.applyOffsetLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-16", hours: 8 },
          { date: "2026-03-17", hours: 8 },
        ],
        reason: "Trip",
      })

      const updated = await offsetService.handleOffsetLeaveDecision({
        groupId: group[0].leave_group_id,
        status: "REJECTED",
        hrId: hr.id,
      })

      expect(updated.every((row) => row.status === "REJECTED")).toBe(true)
      expect(balanceOf(employee.id)).toBe(16)
    })

    it("snapshots the balance after the deduction lands, not the balance at the moment of approval", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })

      const [updated] = await offsetService.handleOffsetLeaveDecision({
        groupId: leave.leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      expect(updated.approval_credits_snapshot).toBe(balanceOf(employee.id))
      expect(updated.approval_credits_snapshot).toBe(8)
    })

    it("snapshots null on rejection", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })

      const [updated] = await offsetService.handleOffsetLeaveDecision({
        groupId: leave.leave_group_id,
        status: "REJECTED",
        hrId: hr.id,
      })

      expect(updated.approval_credits_snapshot).toBeNull()
    })

    it("clears the approval hash, HR signature, and credits snapshot on undo, across the whole group", async () => {
      const group = await offsetService.applyOffsetLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-16", hours: 8 },
          { date: "2026-03-17", hours: 4 },
        ],
        reason: "Family trip",
      })
      await offsetService.handleOffsetLeaveDecision({
        groupId: group[0].leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      const reverted = await offsetService.undoOffsetLeaveDecision({ groupId: group[0].leave_group_id, hrId: hr.id })

      expect(reverted).toHaveLength(2)
      for (const row of reverted) {
        expect(row.approval_hash).toBeNull()
        expect(row.hr_signature_version).toBeNull()
        expect(row.hr_signature_timestamp).toBeNull()
        expect(row.approval_credits_snapshot).toBeNull()
      }
    })
  })

  describe("applying for offset leave across a date range", () => {
    it("writes one row per day under a shared group, defaulting to 8 hours minus the 1-hour lunch deduction", async () => {
      const rows = await offsetService.applyOffsetLeaveRange({
        employeeId: employee.id,
        days: [{ date: "2026-03-16" }, { date: "2026-03-17" }],
        reason: "Trip",
      })

      expect(rows).toHaveLength(2)
      expect(rows[0].leave_group_id).toBe(rows[1].leave_group_id)
      expect(rows.map((r) => r.hours)).toEqual([7, 7])
      expect(rows.every((r) => r.status === "PENDING")).toBe(true)
    })

    it("a single-day range is a group of one", async () => {
      const rows = await offsetService.applyOffsetLeaveRange({
        employeeId: employee.id,
        days: [{ date: "2026-03-16", hours: 4 }],
        reason: "Half day",
      })

      expect(rows).toHaveLength(1)
      expect(rows[0].leave_group_id).toBeTruthy()
    })

    it("lets a half-day inside the range override the 8-hour default", async () => {
      const rows = await offsetService.applyOffsetLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-16", hours: 8 },
          { date: "2026-03-17", hours: 4 },
        ],
        reason: "Trip with a half day",
      })

      // The 8-hour day loses an hour to lunch (issue #91); the 4-hour
      // half-day is under the 5-hour threshold and is left alone.
      expect(rows.map((r) => r.hours)).toEqual([7, 4])
    })

    it("refuses a range whose total exceeds the balance", async () => {
      await expect(
        offsetService.applyOffsetLeaveRange({
          employeeId: employee.id,
          days: [
            { date: "2026-03-16", hours: 8 },
            { date: "2026-03-17", hours: 8 },
            { date: "2026-03-18", hours: 8 },
          ],
          reason: "Too long",
        }),
      ).rejects.toThrow("Insufficient offset hours. 0 hrs already committed to pending applications, leaving 16 hrs available.")

      expect(await offsetService.getMyOffsetLeaves(employee.id)).toHaveLength(0)
    })

    it("refuses a range that includes a weekend day", async () => {
      await expect(
        offsetService.applyOffsetLeaveRange({
          employeeId: employee.id,
          days: [
            { date: "2026-03-13", hours: 8 }, // Friday
            { date: "2026-03-14", hours: 8 }, // Saturday
          ],
          reason: "Bad range",
        }),
      ).rejects.toThrow(/cannot be applied on weekends/i)
    })
  })

  describe("employee withdrawal", () => {
    it("cancels a pending overtime request", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id })

      await offsetService.withdrawOvertimeRequest({
        requestId: request.id,
        employeeId: employee.id,
      })

      expect((await offsetService.getMyOvertimeRequests(employee.id))[0].status).toBe("CANCELLED")
    })

    it("refuses to withdraw an overtime request HR has already decided", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' })
      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        hrId: hr.id,
      })

      await expect(
        offsetService.withdrawOvertimeRequest({ requestId: request.id, employeeId: employee.id }),
      ).rejects.toThrow("Only pending requests can be withdrawn.")

      expect(balanceOf(employee.id)).toBe(20)
    })

    it("refuses to let one employee withdraw another's request", async () => {
      const other = makeEmployee({ name: "Ben Cruz" })
      const request = makeOvertimeRequest({ employee_id: employee.id })

      await expect(
        offsetService.withdrawOvertimeRequest({ requestId: request.id, employeeId: other.id }),
      ).rejects.toThrow("Unauthorized")
    })

    it("never lets a withdraw racing an HR approval erase the approval's credit", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '09:00', endTime: '13:00' }) // 4 hrs

      const outcomes = await Promise.allSettled([
        offsetService.handleOvertimeDecision({ requestId: request.id, status: "APPROVED_OFFSET", hrId: hr.id }),
        offsetService.withdrawOvertimeRequest({ requestId: request.id, employeeId: employee.id }),
      ])

      const finalStatus = findRow("overtime_requests", request.id).status
      // Whichever one actually landed last, the row and the balance must
      // agree: a CANCELLED row can never coexist with a credited balance,
      // and an APPROVED_OFFSET row can never coexist with an uncredited one.
      if (finalStatus === "CANCELLED") {
        expect(balanceOf(employee.id)).toBe(16)
      } else {
        expect(finalStatus).toBe("APPROVED_OFFSET")
        expect(balanceOf(employee.id)).toBe(20)
        expect(outcomes.some((o) => o.status === "rejected")).toBe(true)
      }
    })

    it("returns the hours when an approved offset leave is withdrawn", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })
      await offsetService.handleOffsetLeaveDecision({
        groupId: leave.leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      await offsetService.withdrawOffsetLeave({ leaveId: leave.id, employeeId: employee.id })

      expect(balanceOf(employee.id)).toBe(16)
      expect((await offsetService.getMyOffsetLeaves(employee.id))[0].status).toBe("CANCELLED")
    })

    it("warns HR when an already-approved leave is withdrawn", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })
      await offsetService.handleOffsetLeaveDecision({
        groupId: leave.leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })
      await waitForNetworkIdle()
      const before = db.rows("notifications").length

      await offsetService.withdrawOffsetLeave({ leaveId: leave.id, employeeId: employee.id })
      await waitForNetworkIdle()

      const added = db.rows("notifications").slice(before)
      expect(added.map((n) => n.recipient_id)).toEqual([hr.id])
      expect(added[0].title).toBe("Approved Leave Withdrawn")
    })

    it("withdraws every day in an approved date-range group together, refunding the group's total hours", async () => {
      const group = await offsetService.applyOffsetLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-16", hours: 8 },
          { date: "2026-03-17", hours: 4 },
        ],
        reason: "Family trip",
      })
      await offsetService.handleOffsetLeaveDecision({
        groupId: group[0].leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })
      expect(balanceOf(employee.id)).toBe(5) // 16 - 7 (8 minus lunch) - 4

      // Withdrawing via just one day's row id must withdraw and refund the whole group.
      await offsetService.withdrawOffsetLeave({ leaveId: group[0].id, employeeId: employee.id })

      expect(balanceOf(employee.id)).toBe(16)
      const rows = await offsetService.getMyOffsetLeaves(employee.id)
      expect(rows.every((row) => row.status === "CANCELLED")).toBe(true)
    })

    it("refuses to withdraw a leave that was already rejected or cancelled", async () => {
      const rejected = makeOffsetLeave({ employee_id: employee.id, status: "REJECTED" })
      const cancelled = makeOffsetLeave({ employee_id: employee.id, status: "CANCELLED" })

      for (const leave of [rejected, cancelled]) {
        await expect(
          offsetService.withdrawOffsetLeave({ leaveId: leave.id, employeeId: employee.id }),
        ).rejects.toThrow("Cannot withdraw this request.")
      }
    })
  })

  describe("reading requests", () => {
    it("filters by date range", async () => {
      makeOvertimeRequest({ employee_id: employee.id, date: "2026-02-10" })
      makeOvertimeRequest({ employee_id: employee.id, date: "2026-03-10" })

      const march = await offsetService.getMyOvertimeRequests(
        employee.id,
        "2026-03-01",
        "2026-03-31",
      )

      expect(march.map((r) => r.date)).toEqual(["2026-03-10"])
    })

    it("excludes a request dated the 1st of the following month from a month filter", async () => {
      // getMonthBoundaries returns an EXCLUSIVE endDate (the 1st of the next
      // month), matching what FloatingMonthPicker feeds these calls.
      makeOvertimeRequest({ employee_id: employee.id, date: "2026-03-10" })
      makeOvertimeRequest({ employee_id: employee.id, date: "2026-04-01" })

      const { startDate, endDate } = getMonthBoundaries("2026-03")
      const march = await offsetService.getMyOvertimeRequests(employee.id, startDate, endDate)

      expect(march.map((r) => r.date)).toEqual(["2026-03-10"])
    })

    it("gives HR every request with the applicant and their balance attached", async () => {
      makeOvertimeRequest({ employee_id: employee.id })

      const all = await offsetService.getAllOvertimeRequests()

      expect(all[0].employee).toMatchObject({ name: "Ana Reyes", offset_hours_balance: 16 })
    })

    it("lists balances alphabetically, excluding deleted employees", async () => {
      makeEmployee({ name: "Zoe", offset_hours_balance: 4 })
      makeEmployee({ name: "Gone", is_deleted: true })

      const balances = await offsetService.getEmployeeOffsetBalances()

      expect(balances.map((b) => b.name)).toEqual(["Ana Reyes", "HR Officer", "Zoe"])
    })

    describe("dateless pending reads", () => {
      it("returns cross-month and past-month pending requests, excluding decided/withdrawn ones", async () => {
        makeOvertimeRequest({ employee_id: employee.id, date: "2026-02-10", status: "PENDING" }) // past month
        makeOvertimeRequest({ employee_id: employee.id, date: "2026-04-10", status: "PENDING" }) // future month
        makeOvertimeRequest({ employee_id: employee.id, date: "2026-03-10", status: "APPROVED_PAID" }) // decided
        makeOvertimeRequest({ employee_id: employee.id, date: "2026-03-11", status: "CANCELLED" }) // withdrawn

        const myPending = await offsetService.getMyPendingOvertimeRequests(employee.id)
        expect(myPending.map((r) => r.date)).toEqual(["2026-02-10", "2026-04-10"])

        const allPending = await offsetService.getAllPendingOvertimeRequests()
        expect(allPending.map((r) => r.date)).toEqual(["2026-02-10", "2026-04-10"])
        expect(allPending[0].employee.name).toBe("Ana Reyes")
      })
      
      it("returns cross-month and past-month pending offset leaves, excluding decided ones", async () => {
        makeOffsetLeave({ employee_id: employee.id, date: "2026-02-10", status: "PENDING" })
        makeOffsetLeave({ employee_id: employee.id, date: "2026-04-10", status: "PENDING" })
        makeOffsetLeave({ employee_id: employee.id, date: "2026-03-10", status: "APPROVED" })
        makeOffsetLeave({ employee_id: employee.id, date: "2026-03-11", status: "REJECTED" })

        const myPending = await offsetService.getMyPendingOffsetLeaves(employee.id)
        expect(myPending.map((r) => r.date)).toEqual(["2026-02-10", "2026-04-10"])

        const allPending = await offsetService.getAllPendingOffsetLeaves()
        expect(allPending.map((r) => r.date)).toEqual(["2026-02-10", "2026-04-10"])
      })
    })
  })

  describe("Document Center: stamping printed records", () => {
    it("stamps a single-day offset leave by id", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id, status: "APPROVED" })

      await offsetService.markOffsetLeavesPrinted({ id: leave.id, hrId: hr.id })

      const row = db.rows("offset_leaves").find((r) => r.id === leave.id)
      expect(row.printed_by).toBe(hr.id)
      expect(row.printed_at).toEqual(expect.any(String))
    })

    it("stamps every row in a leave_group_id when printed as a range", async () => {
      const groupId = crypto.randomUUID()
      const day1 = makeOffsetLeave({ employee_id: employee.id, status: "APPROVED", leave_group_id: groupId, date: "2026-03-10" })
      const day2 = makeOffsetLeave({ employee_id: employee.id, status: "APPROVED", leave_group_id: groupId, date: "2026-03-11" })

      await offsetService.markOffsetLeavesPrinted({ groupId, hrId: hr.id })

      const rows = db.rows("offset_leaves").filter((r) => r.id === day1.id || r.id === day2.id)
      expect(rows.every((r) => r.printed_by === hr.id)).toBe(true)
    })

    it("stamps an overtime request by id (never grouped)", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, status: "APPROVED_PAID" })

      await offsetService.markOvertimeRequestsPrinted({ id: request.id, hrId: hr.id })

      const row = db.rows("overtime_requests").find((r) => r.id === request.id)
      expect(row.printed_by).toBe(hr.id)
      expect(row.printed_at).toEqual(expect.any(String))
    })
  })
})

describe("cleanAttachments", () => {
  it("keeps only entries that finished uploading", () => {
    expect(
      cleanAttachments([{ url: "https://ok.test/a.pdf" }, { name: "failed.pdf" }, null]),
    ).toEqual([{ url: "https://ok.test/a.pdf" }])
  })

  it("stores null rather than an empty list, so old and new rows read alike", () => {
    expect(cleanAttachments([])).toBeNull()
    expect(cleanAttachments(null)).toBeNull()
    expect(cleanAttachments(undefined)).toBeNull()
    expect(cleanAttachments([{ name: "failed.pdf" }])).toBeNull()
  })
})

async function setOffsetBalance(employeeId, hours) {
  const { supabase } = await import("@/lib/supabase")
  await supabase.from("employees").update({ offset_hours_balance: hours }).eq("id", employeeId)
}
