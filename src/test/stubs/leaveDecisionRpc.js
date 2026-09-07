import { stubRpc } from "@/test/msw/server"
import { db, updateRow } from "@/test/db/store"

const SIL_ELIGIBLE_STATUS = "Regular"

const findRow = (table, id) => db.internal.rowsOf(table).find((row) => row.id === id)

/**
 * The Offset and SIL decision functions (issues #109, #110, #111 — see ADR
 * 0013) live in Postgres, which the fake database does not execute. This
 * re-implements them in JS against the same in-memory store, the pattern
 * `stubOvertimeDecisionRpcs` established for #108.
 *
 * The two record types differ in exactly three ways — their table, their
 * balance column, and whether the refund is gated on employment status — so
 * they are one parameterised implementation rather than two copies that would
 * drift apart the first time only one of them was corrected.
 *
 * Because a stub body never awaits mid-computation, two calls fired
 * concurrently still each run to completion before the next one starts — the
 * same atomicity the real functions get from locking the group's day-rows and
 * the employee row with `FOR UPDATE`.
 */
function stubLeaveDecisionRpcs({ table, balanceColumn, names, refundIsGated }) {
  const groupRows = (groupId) =>
    db.internal
      .rowsOf(table)
      .filter((row) => row.leave_group_id === groupId)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))

  const totalHours = (rows) => rows.reduce((sum, row) => sum + parseFloat(row.hours || 0), 0)

  const balanceOf = (employee) => parseFloat(employee[balanceColumn] || 0)

  /**
   * Credits a refund the way the SQL does. For SIL this is a gate, not a cap:
   * a still-eligible employee gets the whole amount and anyone else gets none,
   * with the caller told so it can record the anomaly HR reviews. Offset has
   * no such gate, so its refund is unconditional.
   */
  const refund = (employee, hours) => {
    if (refundIsGated && employee.employment_status !== SIL_ELIGIBLE_STATUS) return true
    updateRow("employees", employee, {
      [balanceColumn]: balanceOf(employee) + hours,
    })
    return false
  }

  /**
   * Issue #111: an approved leave whose first date has passed has been taken —
   * its hours are no longer the employee's to reclaim. Only an approved group
   * is guarded; a pending one has spent nothing and must stay withdrawable.
   */
  const assertNotAlreadyTaken = (previousStatus, rows) => {
    if (previousStatus !== "APPROVED") return
    const firstDate = rows.map((row) => row.date).sort()[0]
    const today = new Date().toISOString().slice(0, 10)
    if (firstDate < today) {
      throw new Error(
        `This leave started on ${firstDate} and has already been taken, so its hours cannot be withdrawn. Ask HR to undo the approval if the leave was not actually taken.`,
      )
    }
  }

  /** The facts about an employee the SQL reports back alongside the rows. */
  const describe = (employee) => ({
    employee_id: employee.id,
    ...(refundIsGated
      ? { employee_name: employee.name, employment_status: employee.employment_status }
      : {}),
  })

  stubRpc(names.decide, (args) => {
    const rows = groupRows(args.p_group_id)
    if (rows.length === 0) throw new Error("Leave application not found.")
    if (rows.some((row) => row.status !== "PENDING")) {
      throw new Error("This leave application has already been decided.")
    }

    const employee = findRow("employees", rows[0].employee_id)
    const hours = totalHours(rows)
    let creditsSnapshot = null

    if (args.p_status === "APPROVED") {
      if (refundIsGated && employee.employment_status !== SIL_ELIGIBLE_STATUS) {
        throw new Error("Only Regular employees are eligible for SIL leave.")
      }
      const balance = balanceOf(employee)
      if (balance < hours) {
        throw new Error(`Cannot approve leave. Employee currently only has ${balance} hrs balance.`)
      }
      creditsSnapshot = balance - hours
      updateRow("employees", employee, { [balanceColumn]: creditsSnapshot })
    }

    const updated = rows.map((row) =>
      updateRow(table, row, {
        status: args.p_status,
        hr_notes: args.p_hr_notes || null,
        hr_processed_by: args.p_hr_id || null,
        ...(table === "sil_leaves" ? { hr_processed_at: new Date().toISOString() } : {}),
        approval_hash: "stub-approval-hash",
        hr_signature_version: null,
        hr_signature_timestamp: null,
        approval_credits_snapshot: creditsSnapshot,
      }),
    )

    return {
      rows: updated,
      ...describe(employee),
      total_hours: hours,
      dates: updated.map((row) => row.date),
    }
  })

  stubRpc(names.undo, (args) => {
    const rows = groupRows(args.p_group_id)
    if (rows.length === 0) throw new Error("Leave application not found.")

    const previousStatus = rows[0].status
    if (previousStatus === "PENDING") throw new Error("Leave is already pending.")

    const employee = findRow("employees", rows[0].employee_id)
    const hours = totalHours(rows)
    const refundWithheld = previousStatus === "APPROVED" ? refund(employee, hours) : false

    const updated = rows.map((row) =>
      updateRow(table, row, {
        status: "PENDING",
        hr_notes: null,
        hr_processed_by: null,
        ...(table === "sil_leaves" ? { hr_processed_at: null } : {}),
        approval_hash: null,
        hr_signature_version: null,
        hr_signature_timestamp: null,
        approval_credits_snapshot: null,
      }),
    )

    return {
      rows: updated,
      ...describe(employee),
      refund_withheld: refundWithheld,
      total_hours: hours,
      dates: updated.map((row) => row.date),
      previous_status: previousStatus,
    }
  })

  stubRpc(names.withdraw, (args) => {
    const clicked = findRow(table, args.p_leave_id)
    if (!clicked) throw new Error("Leave application not found.")
    if (clicked.employee_id !== args.p_employee_id) throw new Error("Unauthorized")
    if (clicked.status === "REJECTED" || clicked.status === "CANCELLED") {
      throw new Error("Cannot withdraw this request.")
    }

    const rows = groupRows(clicked.leave_group_id)
    const previousStatus = clicked.status
    assertNotAlreadyTaken(previousStatus, rows)

    const employee = findRow("employees", clicked.employee_id)
    const hours = totalHours(rows)

    const updated = rows.map((row) => updateRow(table, row, { status: "CANCELLED" }))
    const refundWithheld = previousStatus === "APPROVED" ? refund(employee, hours) : false

    return {
      rows: updated,
      ...describe(employee),
      refund_withheld: refundWithheld,
      group_id: clicked.leave_group_id,
      total_hours: hours,
      dates: updated.map((row) => row.date),
      previous_status: previousStatus,
    }
  })
}

/** `decide_offset_leave_decision` / `undo_…` / `withdraw_offset_leave` (#109). */
export function stubOffsetLeaveDecisionRpcs() {
  stubLeaveDecisionRpcs({
    table: "offset_leaves",
    balanceColumn: "offset_hours_balance",
    refundIsGated: false,
    names: {
      decide: "decide_offset_leave_decision",
      undo: "undo_offset_leave_decision",
      withdraw: "withdraw_offset_leave",
    },
  })
}

/** `decide_sil_leave_decision` / `undo_…` / `cancel_sil_leave` (#110). */
export function stubSilLeaveDecisionRpcs() {
  stubLeaveDecisionRpcs({
    table: "sil_leaves",
    balanceColumn: "sil_hours_balance",
    refundIsGated: true,
    names: {
      decide: "decide_sil_leave_decision",
      undo: "undo_sil_leave_decision",
      withdraw: "cancel_sil_leave",
    },
  })
}
