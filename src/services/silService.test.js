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
        startTime: '09:00', endTime: '17:00',
        reason: "Medical appointment",
        employeeName: "Ana Reyes",
      })

      const mine = await silService.getMySilLeaves(employee.id)
      expect(mine).toHaveLength(1)
      expect(mine[0]).toMatchObject({
        start_time: "09:00",
        end_time: "17:00",
        hours: 7,
        status: "PENDING",
        reason: "Medical appointment",
      })
    })

    it("does not touch the balance until HR approves", async () => {
      await silService.applySilLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: '09:00', endTime: '17:00',
        reason: "Medical appointment",
      })

      expect(balanceOf(employee.id)).toBe(40)
    })

    it("refuses more hours than the employee has left", async () => {
      // A window cannot span more than a day, so the balance is what moves —
      // the widest window available has to out-reach it.
      const short = makeEmployee({ name: "Short Balance", sil_hours_balance: 4 })

      await expect(
        silService.applySilLeave({
          employeeId: short.id,
          date: "2026-03-10",
          startTime: "09:00",
          endTime: "17:00",
          reason: "Long trip",
        }),
      ).rejects.toThrow("Insufficient SIL hours balance. You have 4 hrs remaining.")

      expect(await silService.getMySilLeaves(short.id)).toEqual([])
    })

    it("refuses a Saturday or Sunday, matching Offset", async () => {
      // 2026-03-14 is a Saturday, 2026-03-15 a Sunday.
      for (const date of ["2026-03-14", "2026-03-15"]) {
        await expect(
          silService.applySilLeave({
            employeeId: employee.id,
            date,
            startTime: '09:00', endTime: '17:00',
            reason: "Weekend",
          }),
        ).rejects.toThrow(/cannot be applied on weekends/i)
      }

      expect(await silService.getMySilLeaves(employee.id)).toEqual([])
    })

    it("deducts an hour for lunch on a window of 5 hours or more", async () => {
      await silService.applySilLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: "07:30", endTime: "18:00",
        reason: "Full day",
      })

      expect((await silService.getMySilLeaves(employee.id))[0].hours).toBe(9.5) // 10.5-hour window minus 1 hour for lunch
    })

    it("refuses to file for an employee who is not SIL-eligible", async () => {
      // Only Regular employees accrue and spend SIL (issue #91) — this closes
      // the gap where only the refund/undo path checked eligibility.
      const probationary = makeEmployee({ name: "New Hire", sil_hours_balance: 40, employment_status: "Probationary" })

      await expect(
        silService.applySilLeave({
          employeeId: probationary.id,
          date: "2026-03-10",
          startTime: '09:00', endTime: '17:00',
          reason: "Medical appointment",
        }),
      ).rejects.toThrow("Only Regular employees are eligible for SIL leave.")

      expect(await silService.getMySilLeaves(probationary.id)).toEqual([])
    })

    it("computes the application hash and stamps the employee's signature version, matching every other apply path", async () => {
      const signed = makeEmployee({ name: "Signed Employee", sil_hours_balance: 40, signature_path: "sigs/v1.png" })

      await silService.applySilLeave({
        employeeId: signed.id,
        date: "2026-03-10",
        startTime: '09:00', endTime: '17:00',
        reason: "Medical appointment",
      })

      const [stored] = await silService.getMySilLeaves(signed.id)
      expect(stored.application_hash).toBeTruthy()
      expect(stored.employee_signature_version).toBe("sigs/v1.png")
      expect(stored.employee_signature_timestamp).toBeTruthy()
    })

    it("allows an application that uses the balance exactly", async () => {
      await silService.applySilLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: '00:00', endTime: '23:59',
        reason: "Extended leave",
      })

      expect(await silService.getMySilLeaves(employee.id)).toHaveLength(1)
    })

    it("rejects a window that encloses no time", async () => {
      for (const [startTime, endTime] of [
        ["09:00", "09:00"],
        ["", ""],
        [null, "17:00"],
      ]) {
        await expect(
          silService.applySilLeave({
            employeeId: employee.id,
            date: "2026-03-10",
            startTime,
            endTime,
            reason: "Whatever",
          }),
        ).rejects.toThrow("Please enter a valid time window.")
      }
    })

    it("rejects a window that runs past midnight", async () => {
      // A leave crossing midnight is a mistyped PM, not a night shift — only
      // overtime is allowed to span two days.
      await expect(
        silService.applySilLeave({
          employeeId: employee.id,
          date: "2026-03-10",
          startTime: "17:00",
          endTime: "02:00",
          reason: "Overnight",
        }),
      ).rejects.toThrow("End time must be after start time.")

      expect(await silService.getMySilLeaves(employee.id)).toEqual([])
    })

    it("requires a reason", async () => {
      await expect(
        silService.applySilLeave({
          employeeId: employee.id,
          date: "2026-03-10",
          startTime: '09:00', endTime: '13:00',
          reason: "   ",
        }),
      ).rejects.toThrow("Please provide a reason for the SIL leave.")
    })

    it("derives a part-hour window down to the half hour", async () => {
      await silService.applySilLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: "09:00",
        endTime: "13:30",
        reason: "Half day",
      })

      expect((await silService.getMySilLeaves(employee.id))[0].hours).toBe(4.5)
    })

    it("keeps uploaded supporting files with the application", async () => {
      await silService.applySilLeave({
        employeeId: employee.id,
        date: "2026-03-10",
        startTime: '09:00', endTime: '13:00',
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
        startTime: '09:00', endTime: '13:00',
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
        startTime: '09:00', endTime: '13:00',
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
      const leave = makeSilLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })

      await silService.handleSilLeaveDecision({
        groupId: leave.leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      expect(balanceOf(employee.id)).toBe(32)
    })

    it("leaves the balance alone when a leave is rejected", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })

      await silService.handleSilLeaveDecision({
        groupId: leave.leave_group_id,
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
      const leave = makeSilLeave({ employee_id: employee.id, startTime: '00:00', endTime: '23:59' })
      await supabaseSetBalance(employee.id, 8)

      await expect(
        silService.handleSilLeaveDecision({ groupId: leave.leave_group_id, status: "APPROVED", hrId: hr.id }),
      ).rejects.toThrow("Cannot approve leave. Employee currently only has 8 hrs balance.")

      expect((await silService.getMySilLeaves(employee.id))[0].status).toBe("PENDING")
    })

    it("refuses to approve a leave for an employee who is no longer SIL-eligible", async () => {
      // HR changed the employee's status after the leave was filed — approval
      // must re-check eligibility, not just balance (issue #91).
      const probationary = makeEmployee({ name: "New Hire", sil_hours_balance: 40, employment_status: "Probationary" })
      const leave = makeSilLeave({ employee_id: probationary.id, startTime: '09:00', endTime: '17:00' })

      await expect(
        silService.handleSilLeaveDecision({ groupId: leave.leave_group_id, status: "APPROVED", hrId: hr.id }),
      ).rejects.toThrow("Only Regular employees are eligible for SIL leave.")

      expect((await silService.getMySilLeaves(probationary.id))[0].status).toBe("PENDING")
      expect(balanceOf(probationary.id)).toBe(40)
    })

    it("stamps who processed the decision and when", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })

      await silService.handleSilLeaveDecision({
        groupId: leave.leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      const [stored] = await silService.getMySilLeaves(employee.id)
      expect(stored.hr_processed_by).toBe(hr.id)
      expect(stored.hr_processed_at).toBeTruthy()
    })

    it("tells the employee the outcome", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })

      await silService.handleSilLeaveDecision({
        groupId: leave.leave_group_id,
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

    it("approves a multi-day range atomically, spending its total hours in one balance update", async () => {
      const group = await silService.applySilLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-10", hours: 8 },
          { date: "2026-03-11", hours: 4 },
        ],
        reason: "Family trip",
      })

      const updated = await silService.handleSilLeaveDecision({
        groupId: group[0].leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      expect(updated).toHaveLength(2)
      expect(updated.every((row) => row.status === "APPROVED")).toBe(true)
      expect(balanceOf(employee.id)).toBe(29) // 40 - 7 (8 minus lunch) - 4
    })

    it("leaves every day in the range untouched when the group can't be approved", async () => {
      const group = await silService.applySilLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-10", hours: 8 },
          { date: "2026-03-11", hours: 8 },
        ],
        reason: "Trip",
      })
      await supabaseSetBalance(employee.id, 4)

      await expect(
        silService.handleSilLeaveDecision({
          groupId: group[0].leave_group_id,
          status: "APPROVED",
          hrId: hr.id,
        }),
      ).rejects.toThrow("Cannot approve leave. Employee currently only has 4 hrs balance.")

      const rows = await silService.getMySilLeaves(employee.id)
      expect(rows.every((row) => row.status === "PENDING")).toBe(true)
      expect(balanceOf(employee.id)).toBe(4)
    })

    it("rejects every day in the range together", async () => {
      const group = await silService.applySilLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-10", hours: 8 },
          { date: "2026-03-11", hours: 8 },
        ],
        reason: "Trip",
      })

      const updated = await silService.handleSilLeaveDecision({
        groupId: group[0].leave_group_id,
        status: "REJECTED",
        hrId: hr.id,
      })

      expect(updated.every((row) => row.status === "REJECTED")).toBe(true)
      expect(balanceOf(employee.id)).toBe(40)
    })

    it("snapshots the balance after the deduction lands, not the balance at the moment of approval", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })

      const [updated] = await silService.handleSilLeaveDecision({
        groupId: leave.leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      expect(updated.approval_credits_snapshot).toBe(balanceOf(employee.id))
      expect(updated.approval_credits_snapshot).toBe(32)
    })

    it("snapshots null on rejection", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })

      const [updated] = await silService.handleSilLeaveDecision({
        groupId: leave.leave_group_id,
        status: "REJECTED",
        hrId: hr.id,
      })

      expect(updated.approval_credits_snapshot).toBeNull()
    })
  })

  describe("applying for leave across a date range", () => {
    it("writes one row per day under a shared group, defaulting to 8 hours minus the 1-hour lunch deduction", async () => {
      const rows = await silService.applySilLeaveRange({
        employeeId: employee.id,
        days: [{ date: "2026-03-10" }, { date: "2026-03-11" }],
        reason: "Trip",
      })

      expect(rows).toHaveLength(2)
      expect(rows[0].leave_group_id).toBe(rows[1].leave_group_id)
      expect(rows.map((r) => r.hours)).toEqual([7, 7])
    })

    it("lets a half-day inside the range override the 8-hour default", async () => {
      const rows = await silService.applySilLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-10", hours: 8 },
          { date: "2026-03-11", hours: 4 },
        ],
        reason: "Trip with a half day",
      })

      // The 8-hour day loses an hour to lunch (issue #91); the 4-hour
      // half-day is under the 5-hour threshold and is left alone.
      expect(rows.map((r) => r.hours)).toEqual([7, 4])
    })

    it("refuses a range that includes a weekend day, matching Offset", async () => {
      await expect(
        silService.applySilLeaveRange({
          employeeId: employee.id,
          days: [
            { date: "2026-03-13", hours: 8 }, // Friday
            { date: "2026-03-14", hours: 8 }, // Saturday
          ],
          reason: "Bad range",
        }),
      ).rejects.toThrow(/cannot be applied on weekends/i)
    })

    it("refuses to file for an employee who is not SIL-eligible", async () => {
      const probationary = makeEmployee({ name: "New Hire", sil_hours_balance: 40, employment_status: "Probationary" })

      await expect(
        silService.applySilLeaveRange({
          employeeId: probationary.id,
          days: [{ date: "2026-03-10" }],
          reason: "Trip",
        }),
      ).rejects.toThrow("Only Regular employees are eligible for SIL leave.")

      expect(await silService.getMySilLeaves(probationary.id)).toEqual([])
    })

    it("refuses a range whose total exceeds the balance", async () => {
      const short = makeEmployee({ name: "Short Balance", sil_hours_balance: 4 })

      await expect(
        silService.applySilLeaveRange({
          employeeId: short.id,
          days: [
            { date: "2026-03-10", hours: 8 },
            { date: "2026-03-11", hours: 8 },
          ],
          reason: "Too long",
        }),
      ).rejects.toThrow("Insufficient SIL hours balance. You have 4 hrs remaining.")

      expect(await silService.getMySilLeaves(short.id)).toEqual([])
    })
  })

  describe("undoing a decision", () => {
    it("gives the hours back and returns the leave to pending", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })
      await silService.handleSilLeaveDecision({
        groupId: leave.leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      await silService.undoSilLeaveDecision({ groupId: leave.leave_group_id, hrId: hr.id })

      expect(balanceOf(employee.id)).toBe(40)
      expect((await silService.getMySilLeaves(employee.id))[0]).toMatchObject({
        status: "PENDING",
        hr_notes: null,
        hr_processed_by: null,
      })
    })

    it("does not credit hours when undoing a rejection", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })
      await silService.handleSilLeaveDecision({
        groupId: leave.leave_group_id,
        status: "REJECTED",
        hrId: hr.id,
      })

      await silService.undoSilLeaveDecision({ groupId: leave.leave_group_id, hrId: hr.id })

      expect(balanceOf(employee.id)).toBe(40)
    })

    it("refuses to undo a leave that is already pending", async () => {
      const leave = makeSilLeave({ employee_id: employee.id })

      await expect(
        silService.undoSilLeaveDecision({ groupId: leave.leave_group_id, hrId: hr.id }),
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
      const leave = makeSilLeave({ employee_id: probationary.id, startTime: '09:00', endTime: '17:00' })
      await approveWithoutEligibilityCheck(leave.id, probationary.id, hr.id)

      await silService.undoSilLeaveDecision({ groupId: leave.leave_group_id, hrId: hr.id })

      expect(balanceOf(probationary.id)).toBe(0)
    })

    it("flags the withheld refund for HR to review", async () => {
      const probationary = makeEmployee({
        name: "New Hire",
        sil_hours_balance: 8,
        employment_status: "Probationary",
      })
      const leave = makeSilLeave({ employee_id: probationary.id, startTime: '09:00', endTime: '17:00' })
      await approveWithoutEligibilityCheck(leave.id, probationary.id, hr.id)

      await silService.undoSilLeaveDecision({ groupId: leave.leave_group_id, hrId: hr.id })

      await waitForNetworkIdle()

      const anomaly = db
        .rows("system_audit_logs")
        .find((e) => e.metadata?.event === "SIL_REFUND_ANOMALY")
      expect(anomaly.content).toContain("New Hire")
      expect(anomaly.content).toContain("Probationary")
    })

    it("clears the approval hash, HR signature, and credits snapshot on undo, across the whole group", async () => {
      const group = await silService.applySilLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-10", hours: 8 },
          { date: "2026-03-11", hours: 4 },
        ],
        reason: "Family trip",
      })
      await silService.handleSilLeaveDecision({
        groupId: group[0].leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      const reverted = await silService.undoSilLeaveDecision({ groupId: group[0].leave_group_id, hrId: hr.id })

      expect(reverted).toHaveLength(2)
      for (const row of reverted) {
        expect(row.approval_hash).toBeNull()
        expect(row.hr_signature_version).toBeNull()
        expect(row.hr_signature_timestamp).toBeNull()
        expect(row.approval_credits_snapshot).toBeNull()
      }
    })
  })

  describe("employee cancellation", () => {
    it("cancels a pending application", async () => {
      const leave = makeSilLeave({ employee_id: employee.id })

      await silService.cancelMySilLeave({ leaveId: leave.id, employeeId: employee.id })

      expect((await silService.getMySilLeaves(employee.id))[0].status).toBe("CANCELLED")
    })

    it("returns the hours when cancelling an approved leave", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, startTime: '09:00', endTime: '17:00' })
      await silService.handleSilLeaveDecision({
        groupId: leave.leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })

      await silService.cancelMySilLeave({ leaveId: leave.id, employeeId: employee.id })

      expect(balanceOf(employee.id)).toBe(40)
    })

    it("cancels every day in an approved date-range group together, refunding the group's total hours", async () => {
      const group = await silService.applySilLeaveRange({
        employeeId: employee.id,
        days: [
          { date: "2026-03-10", hours: 8 },
          { date: "2026-03-11", hours: 4 },
        ],
        reason: "Family trip",
      })
      await silService.handleSilLeaveDecision({
        groupId: group[0].leave_group_id,
        status: "APPROVED",
        hrId: hr.id,
      })
      expect(balanceOf(employee.id)).toBe(29) // 40 - 7 (8 minus lunch) - 4

      // Cancelling via just one day's row id must cancel and refund the whole group.
      await silService.cancelMySilLeave({ leaveId: group[0].id, employeeId: employee.id })

      expect(balanceOf(employee.id)).toBe(40)
      const rows = await silService.getMySilLeaves(employee.id)
      expect(rows.every((row) => row.status === "CANCELLED")).toBe(true)
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

    describe("dateless pending reads", () => {
      it("returns cross-month and past-month pending requests, excluding decided/withdrawn ones", async () => {
        makeSilLeave({ employee_id: employee.id, date: "2026-02-10", status: "PENDING" }) // past month
        makeSilLeave({ employee_id: employee.id, date: "2026-04-10", status: "PENDING" }) // future month
        makeSilLeave({ employee_id: employee.id, date: "2026-03-10", status: "APPROVED" }) // decided
        makeSilLeave({ employee_id: employee.id, date: "2026-03-11", status: "CANCELLED" }) // withdrawn

        const myPending = await silService.getMyPendingSilLeaves(employee.id)
        expect(myPending.map((r) => r.date)).toEqual(["2026-02-10", "2026-04-10"])

        const allPending = await silService.getAllPendingSilLeaves()
        expect(allPending.map((r) => r.date)).toEqual(["2026-02-10", "2026-04-10"])
        expect(allPending[0].employee.name).toBe("Ana Reyes")
      })
    })
  })

  describe("Document Center: stamping printed records", () => {
    it("stamps a single-day leave by id", async () => {
      const leave = makeSilLeave({ employee_id: employee.id, status: "APPROVED" })

      await silService.markSilLeavesPrinted({ id: leave.id, hrId: hr.id })

      const row = db.rows("sil_leaves").find((r) => r.id === leave.id)
      expect(row.printed_by).toBe(hr.id)
      expect(row.printed_at).toEqual(expect.any(String))
    })

    it("stamps every row in a leave_group_id when printed as a range", async () => {
      const groupId = crypto.randomUUID()
      const day1 = makeSilLeave({ employee_id: employee.id, status: "APPROVED", leave_group_id: groupId, date: "2026-03-10" })
      const day2 = makeSilLeave({ employee_id: employee.id, status: "APPROVED", leave_group_id: groupId, date: "2026-03-11" })

      await silService.markSilLeavesPrinted({ groupId, hrId: hr.id })

      const rows = db.rows("sil_leaves").filter((r) => r.id === day1.id || r.id === day2.id)
      expect(rows.every((r) => r.printed_by === hr.id)).toBe(true)
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
