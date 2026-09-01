import { beforeEach, describe, expect, it } from "vitest"
import { cleanAttachments, offsetService } from "./offsetService"
import { db } from "@/test/db/store"
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
  })

  const balanceOf = (id) => db.rows("employees").find((e) => e.id === id).offset_hours_balance

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
      expect(mine[0]).toMatchObject({ startTime: '09:00', endTime: '13:00', status: "PENDING", reason: "Server migration" })
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

    it("rejects hours that are not a positive number", async () => {
      for (const hours of [0, -1, "not a number"]) {
        await expect(
          offsetService.applyOvertime({
            employeeId: employee.id,
            date: "2026-03-10",
            hours,
            reason: "Work",
          }),
        ).rejects.toThrow("Please enter a valid positive number of hours.")
      }
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
      expect(mine[0]).toMatchObject({ startTime: '09:00', endTime: '17:00', status: "PENDING" })
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
      ).rejects.toThrow("Insufficient offset hours balance. You have 16 hrs remaining.")
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

    it("never drives a balance negative when the hours were already spent", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id, startTime: '00:00', endTime: '23:59' })
      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status: "APPROVED_OFFSET",
        hrId: hr.id,
      })
      // The employee spends everything before HR reverses the approval.
      await setOffsetBalance(employee.id, 0)

      await offsetService.undoOvertimeDecision({ requestId: request.id, hrId: hr.id })

      expect(balanceOf(employee.id)).toBe(0)
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

    it("refuses to undo a request that is already pending", async () => {
      const request = makeOvertimeRequest({ employee_id: employee.id })

      await expect(
        offsetService.undoOvertimeDecision({ requestId: request.id, hrId: hr.id }),
      ).rejects.toThrow("Request is already pending.")
    })
  })

  describe("HR decisions on offset leave", () => {
    it("spends the hours when the leave is approved", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })

      await offsetService.handleOffsetLeaveDecision({
        leaveId: leave.id,
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
          leaveId: leave.id,
          status: "APPROVED",
          hrId: hr.id,
        }),
      ).rejects.toThrow("Cannot approve leave. Employee currently only has 4 hrs balance.")

      expect((await offsetService.getMyOffsetLeaves(employee.id))[0].status).toBe("PENDING")
    })

    it("returns the hours when an approval is undone", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })
      await offsetService.handleOffsetLeaveDecision({
        leaveId: leave.id,
        status: "APPROVED",
        hrId: hr.id,
      })

      await offsetService.undoOffsetLeaveDecision({ leaveId: leave.id, hrId: hr.id })

      expect(balanceOf(employee.id)).toBe(16)
    })

    it("refuses to undo a leave that is already pending", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id })

      await expect(
        offsetService.undoOffsetLeaveDecision({ leaveId: leave.id, hrId: hr.id }),
      ).rejects.toThrow("Leave is already pending.")
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

    it("returns the hours when an approved offset leave is withdrawn", async () => {
      const leave = makeOffsetLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })
      await offsetService.handleOffsetLeaveDecision({
        leaveId: leave.id,
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
        leaveId: leave.id,
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
