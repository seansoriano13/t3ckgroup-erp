import { beforeEach, describe, expect, it } from "vitest"
import { silService } from "./silService"
import { db } from "@/test/db/store"
import { makeEmployee, makeHrEmployee, makeSilLeave } from "@/test/factories"
import { waitForNetworkIdle } from "@/test/network"
import { getMonthBoundaries } from "@/utils/dateUtils"

/**
 * Service Incentive Leave is a statutory entitlement measured in hours, so the
 * only assertion that matters is what an employee's balance reads afterwards.
 * Every test checks the balance through the service, then reads the stored row
 * only where the balance itself is the thing under test.
 */
describe("silService", () => {
  let employee
  let hr

  beforeEach(() => {
    employee = makeEmployee({ name: "Ana Reyes", sil_hours_balance: 40 })
    hr = makeHrEmployee({ name: "HR Officer" })
  })

  const balanceOf = (id) => db.rows("employees").find((e) => e.id === id).sil_hours_balance

  describe("applying for leave", () => {
    it("files a pending application the employee can see", async () => {
      await silService.applySilLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        hours: 8,
        reason: "Medical appointment",
        employeeName: "Ana Reyes",
      })

      const mine = await silService.getMySilLeaves(employee.id)
      expect(mine).toHaveLength(1)
      expect(mine[0]).toMatchObject({ hours: 8, status: "PENDING", reason: "Medical appointment" })
    })

    it("does not touch the balance until HR approves", async () => {
      await silService.applySilLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        hours: 8,
        reason: "Medical appointment",
      })

      expect(balanceOf(employee.id)).toBe(40)
    })

    it("refuses more hours than the employee has left", async () => {
      await expect(
        silService.applySilLeave({
          employeeId: employee.id,
          date: "2026-03-10",
          hours: 48,
          reason: "Long trip",
        }),
      ).rejects.toThrow("Insufficient SIL hours balance. You have 40 hrs remaining.")

      expect(await silService.getMySilLeaves(employee.id)).toEqual([])
    })

    it("allows an application that uses the balance exactly", async () => {
      await silService.applySilLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        hours: 40,
        reason: "Extended leave",
      })

      expect(await silService.getMySilLeaves(employee.id)).toHaveLength(1)
    })

    it("rejects zero, negative and non-numeric hours", async () => {
      for (const hours of [0, -4, "abc", null]) {
        await expect(
          silService.applySilLeave({
            employeeId: employee.id,
            date: "2026-03-10",
            hours,
            reason: "Whatever",
          }),
        ).rejects.toThrow("Please enter a valid positive number of hours.")
      }
    })

    it("requires a reason", async () => {
      await expect(
        silService.applySilLeave({
          employeeId: employee.id,
          date: "2026-03-10",
          hours: 4,
          reason: "   ",
        }),
      ).rejects.toThrow("Please provide a reason for the SIL leave.")
    })

    it("accepts hours typed into a form as a string", async () => {
      await silService.applySilLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        hours: "4.5",
        reason: "Half day",
      })

      expect((await silService.getMySilLeaves(employee.id))[0].hours).toBe(4.5)
    })

    it("keeps uploaded supporting files with the application", async () => {
      await silService.applySilLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        hours: 4,
        reason: "Medical",
        attachments: [
          { url: "https://res.cloudinary.test/cert.pdf", name: "cert.pdf" },
          { name: "never-uploaded.pdf" },
        ],
      })

      const [leave] = await silService.getMySilLeaves(employee.id)
      expect(leave.attachments).toEqual([
        { url: "https://res.cloudinary.test/cert.pdf", name: "cert.pdf" },
      ])
    })

    it("stores no attachments as null rather than an empty list", async () => {
      await silService.applySilLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        hours: 4,
        reason: "Medical",
      })

      expect((await silService.getMySilLeaves(employee.id))[0].attachments).toBeNull()
    })

    it("tells HR and the super admins about the request", async () => {
      const superAdmin = makeEmployee({ name: "Boss", is_super_admin: true })
      const bystander = makeEmployee({ name: "Colleague" })

      await silService.applySilLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        hours: 4,
        reason: "Medical",
        employeeName: "Ana Reyes",
      })

      await waitForNetworkIdle()

      expect(db.rows("notifications")).toHaveLength(2)
      const recipients = db.rows("notifications").map((n) => n.recipient_id)
      expect(recipients).toContain(hr.id)
      expect(recipients).toContain(superAdmin.id)
      expect(recipients).not.toContain(bystander.id)
    })
  })

  describe("HR decisions", () => {
    it("deducts the hours when a leave is approved", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, hours: 8 })

      await silService.handleSilLeaveDecision({
        leaveId: leave.id,
        status: "APPROVED",
        hrId: hr.id,
      })

      expect(balanceOf(employee.id)).toBe(32)
    })

    it("leaves the balance alone when a leave is rejected", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, hours: 8 })

      await silService.handleSilLeaveDecision({
        leaveId: leave.id,
        status: "REJECTED",
        hrNotes: "Peak season",
        hrId: hr.id,
      })

      expect(balanceOf(employee.id)).toBe(40)
      expect((await silService.getMySilLeaves(employee.id))[0]).toMatchObject({
        status: "REJECTED",
        hr_notes: "Peak season",
      })
    })

    it("refuses to approve a leave the balance can no longer cover", async () => {
      // HR reduced the balance after the employee applied.
      const leave = makeSilLeave({ employee_id: employee.id, hours: 24 })
      await supabaseSetBalance(employee.id, 8)

      await expect(
        silService.handleSilLeaveDecision({ leaveId: leave.id, status: "APPROVED", hrId: hr.id }),
      ).rejects.toThrow("Cannot approve leave. Employee currently only has 8 hrs balance.")

      expect((await silService.getMySilLeaves(employee.id))[0].status).toBe("PENDING")
    })

    it("stamps who processed the decision and when", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, hours: 8 })

      await silService.handleSilLeaveDecision({
        leaveId: leave.id,
        status: "APPROVED",
        hrId: hr.id,
      })

      const [stored] = await silService.getMySilLeaves(employee.id)
      expect(stored.hr_processed_by).toBe(hr.id)
      expect(stored.hr_processed_at).toBeTruthy()
    })

    it("tells the employee the outcome", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, hours: 8 })

      await silService.handleSilLeaveDecision({
        leaveId: leave.id,
        status: "APPROVED",
        hrId: hr.id,
      })

      await waitForNetworkIdle()

      expect(db.rows("notifications")).toHaveLength(1)
      expect(db.rows("notifications")[0]).toMatchObject({
        recipient_id: employee.id,
        sender_id: hr.id,
        type: "SIL_LEAVE_DECISION",
      })
    })
  })

  describe("undoing a decision", () => {
    it("gives the hours back and returns the leave to pending", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, hours: 8 })
      await silService.handleSilLeaveDecision({
        leaveId: leave.id,
        status: "APPROVED",
        hrId: hr.id,
      })

      await silService.undoSilLeaveDecision({ leaveId: leave.id, hrId: hr.id })

      expect(balanceOf(employee.id)).toBe(40)
      expect((await silService.getMySilLeaves(employee.id))[0]).toMatchObject({
        status: "PENDING",
        hr_notes: null,
        hr_processed_by: null,
      })
    })

    it("does not credit hours when undoing a rejection", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, hours: 8 })
      await silService.handleSilLeaveDecision({
        leaveId: leave.id,
        status: "REJECTED",
        hrId: hr.id,
      })

      await silService.undoSilLeaveDecision({ leaveId: leave.id, hrId: hr.id })

      expect(balanceOf(employee.id)).toBe(40)
    })

    it("refuses to undo a leave that is already pending", async () => {
      const leave = makeSilLeave({ employee_id: employee.id })

      await expect(
        silService.undoSilLeaveDecision({ leaveId: leave.id, hrId: hr.id }),
      ).rejects.toThrow("Leave is already pending.")
    })

    it("withholds the refund from an employee who is no longer SIL-eligible", async () => {
      // Only Regular employees accrue SIL. If HR changed the status after the
      // leave was approved, re-crediting would grant hours the employee is not
      // entitled to.
      const probationary = makeEmployee({
        name: "New Hire",
        sil_hours_balance: 8,
        employment_status: "Probationary",
      })
      const leave = makeSilLeave({ employee_id: probationary.id, hours: 8 })
      await approveWithoutEligibilityCheck(leave.id, probationary.id, hr.id)

      await silService.undoSilLeaveDecision({ leaveId: leave.id, hrId: hr.id })

      expect(balanceOf(probationary.id)).toBe(0)
    })

    it("flags the withheld refund for HR to review", async () => {
      const probationary = makeEmployee({
        name: "New Hire",
        sil_hours_balance: 8,
        employment_status: "Probationary",
      })
      const leave = makeSilLeave({ employee_id: probationary.id, hours: 8 })
      await approveWithoutEligibilityCheck(leave.id, probationary.id, hr.id)

      await silService.undoSilLeaveDecision({ leaveId: leave.id, hrId: hr.id })

      await waitForNetworkIdle()

      const anomaly = db
        .rows("system_audit_logs")
        .find((e) => e.metadata?.event === "SIL_REFUND_ANOMALY")
      expect(anomaly.content).toContain("New Hire")
      expect(anomaly.content).toContain("Probationary")
    })
  })

  describe("employee cancellation", () => {
    it("cancels a pending application", async () => {
      const leave = makeSilLeave({ employee_id: employee.id })

      await silService.cancelMySilLeave({ leaveId: leave.id, employeeId: employee.id })

      expect((await silService.getMySilLeaves(employee.id))[0].status).toBe("CANCELLED")
    })

    it("returns the hours when cancelling an approved leave", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, hours: 8 })
      await silService.handleSilLeaveDecision({
        leaveId: leave.id,
        status: "APPROVED",
        hrId: hr.id,
      })

      await silService.cancelMySilLeave({ leaveId: leave.id, employeeId: employee.id })

      expect(balanceOf(employee.id)).toBe(40)
    })

    it("refuses to let one employee cancel another's leave", async () => {
      const other = makeEmployee({ name: "Ben Cruz" })
      const leave = makeSilLeave({ employee_id: employee.id })

      await expect(
        silService.cancelMySilLeave({ leaveId: leave.id, employeeId: other.id }),
      ).rejects.toThrow("Unauthorized")

      expect((await silService.getMySilLeaves(employee.id))[0].status).toBe("PENDING")
    })
  })

  describe("reading leaves", () => {
    it("filters an employee's own leaves by date range", async () => {
      makeSilLeave({ employee_id: employee.id, date: "2026-02-10" })
      makeSilLeave({ employee_id: employee.id, date: "2026-03-10" })
      makeSilLeave({ employee_id: employee.id, date: "2026-04-10" })

      const march = await silService.getMySilLeaves(employee.id, "2026-03-01", "2026-03-31")

      expect(march.map((l) => l.date)).toEqual(["2026-03-10"])
    })

    it("excludes a leave dated the 1st of the following month from a month filter", async () => {
      // getMonthBoundaries returns an EXCLUSIVE endDate (the 1st of the next
      // month), matching what FloatingMonthPicker feeds these calls.
      makeSilLeave({ employee_id: employee.id, date: "2026-03-10" })
      makeSilLeave({ employee_id: employee.id, date: "2026-04-01" })

      const { startDate, endDate } = getMonthBoundaries("2026-03")
      const march = await silService.getMySilLeaves(employee.id, startDate, endDate)

      expect(march.map((l) => l.date)).toEqual(["2026-03-10"])
    })

    it("returns only that employee's leaves", async () => {
      const other = makeEmployee({ name: "Ben Cruz", sil_hours_balance: 40 })
      makeSilLeave({ employee_id: employee.id })
      makeSilLeave({ employee_id: other.id })

      expect(await silService.getMySilLeaves(employee.id)).toHaveLength(1)
    })

    it("gives HR every leave with the applicant attached", async () => {
      makeSilLeave({ employee_id: employee.id })

      const all = await silService.getAllSilLeaves()

      expect(all).toHaveLength(1)
      expect(all[0].employee).toMatchObject({ name: "Ana Reyes", sil_hours_balance: 40 })
    })

    it("lists balances alphabetically, excluding deleted employees", async () => {
      makeEmployee({ name: "Zoe", sil_hours_balance: 10 })
      makeEmployee({ name: "Deleted Person", is_deleted: true })

      const balances = await silService.getEmployeeSilBalances()

      expect(balances.map((b) => b.name)).toEqual(["Ana Reyes", "HR Officer", "Zoe"])
    })
  })
})

/**
 * Sets a balance directly, standing in for HR editing it in the employee
 * screen between the application and the decision.
 */
async function supabaseSetBalance(employeeId, hours) {
  const { supabase } = await import("@/lib/supabase")
  await supabase.from("employees").update({ sil_hours_balance: hours }).eq("id", employeeId)
}

/**
 * Approves a leave without going through handleSilLeaveDecision, which would
 * refuse an ineligible employee — the anomaly path only exists for leaves that
 * were approved while the employee was still Regular.
 */
async function approveWithoutEligibilityCheck(leaveId, employeeId, hrId) {
  const { supabase } = await import("@/lib/supabase")
  await supabase
    .from("sil_leaves")
    .update({ status: "APPROVED", hr_processed_by: hrId })
    .eq("id", leaveId)
  await supabase.from("employees").update({ sil_hours_balance: 0 }).eq("id", employeeId)
}
