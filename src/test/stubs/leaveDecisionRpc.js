import { stubRpc } from "@/test/msw/server"
import { db, updateRow } from "@/test/db/store"
import { manilaToday } from "@/lib/manilaDate"

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
function stubLeaveDecisionRpcs({ table, balanceColumn, names, refundIsGated, approvedHours = false }) {
  const groupRows = (groupId) =>
    db.internal
      .rowsOf(table)
      .filter((row) => row.leave_group_id === groupId)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))

  const totalHours = (rows) => rows.reduce((sum, row) => sum + parseFloat(row.hours || 0), 0)

  // #328: Offset spends, and refunds, what HR approved (and gates on the head
  // under its own lock); SIL has neither.
  const spentHours = (rows) =>
    approvedHours
      ? rows.reduce((sum, row) => sum + parseFloat(row.approved_hours ?? row.hours ?? 0), 0)
      : totalHours(rows)

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
    let approved = null

    if (args.p_status === "APPROVED" && approvedHours && rows[0].head_status && rows[0].head_status !== "APPROVED" && !rows[0].hr_override) {
      throw new Error(
        `Cannot approve this offset leave: the department head has not approved this request yet (head_status=${rows[0].head_status}). Use the HR override if this needs to proceed anyway.`,
      )
    }

    if (args.p_status === "APPROVED") {
      approved = approvedHours ? parseFloat(args.p_approved_hours ?? hours) : hours
      if (approvedHours) {
        if (!(approved > 0)) throw new Error("Approved hours must be greater than zero.")
        if (approved > hours) throw new Error("Approved hours cannot exceed the requested hours.")
      }
      if (refundIsGated && employee.employment_status !== SIL_ELIGIBLE_STATUS) {
        throw new Error("Only Regular employees are eligible for SIL leave.")
      }
      const balance = balanceOf(employee)
      if (balance < approved) {
        throw new Error(`Cannot approve leave. Employee currently only has ${balance} hrs balance.`)
      }
      creditsSnapshot = balance - approved
      updateRow("employees", employee, { [balanceColumn]: creditsSnapshot })
    }

    const updated = rows.map((row) =>
      updateRow(table, row, {
        status: args.p_status,
        hr_notes: args.p_hr_notes || null,
        hr_processed_by: args.p_hr_id || null,
        ...(table !== "overtime_requests" ? { hr_processed_at: new Date().toISOString() } : {}),
        approval_hash: "stub-approval-hash",
        hr_signature_version: null,
        hr_signature_timestamp: null,
        approval_credits_snapshot: creditsSnapshot,
        ...(!approvedHours
          ? {}
          : { approved_hours: approved == null ? null : Math.round((parseFloat(row.hours || 0) * approved * 100) / hours) / 100 }),
      }),
    )

    // Same remainder rule as the SQL: the last day absorbs rounding.
    if (approvedHours && approved != null && updated.length) {
      const sum = updated.reduce((acc, row) => acc + row.approved_hours, 0)
      const last = updated.length - 1
      updated[last] = updateRow(table, findRow(table, updated[last].id), {
        approved_hours: Math.round((updated[last].approved_hours + approved - sum) * 100) / 100,
      })
    }

    return {
      rows: updated,
      ...describe(employee),
      total_hours: hours,
      ...(approvedHours ? { approved_hours: approved } : {}),
      dates: updated.map((row) => row.date),
    }
  })

  stubRpc(names.undo, (args) => {
    const rows = groupRows(args.p_group_id)
    if (rows.length === 0) throw new Error("Leave application not found.")

    const previousStatus = rows[0].status
    if (previousStatus === "PENDING") throw new Error("Leave is already pending.")

    const employee = findRow("employees", rows[0].employee_id)
    const hours = spentHours(rows)
    const refundWithheld = previousStatus === "APPROVED" ? refund(employee, hours) : false

    const updated = rows.map((row) =>
      updateRow(table, row, {
        ...(approvedHours ? { approved_hours: null } : {}),
        status: "PENDING",
        hr_notes: null,
        hr_processed_by: null,
        ...(table !== "overtime_requests" ? { hr_processed_at: null } : {}),
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
    const hours = spentHours(rows)

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
    approvedHours: true,
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

/**
 * `decide_lwop_leave_decision` / `undo_...` / `cancel_lwop_leave` (#616). LWOP has no balance, so
 * the stub only moves the group's status and HR stamps. Decide is gated on the head stage and
 * withdraw on the Manila-date cutoff, like the SQL.
 */
export function stubLwopLeaveDecisionRpcs() {
  const table = "lwop_leaves"
  const groupRows = (groupId) =>
    db.internal
      .rowsOf(table)
      .filter((row) => row.leave_group_id === groupId)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const totalHours = (rows) => rows.reduce((sum, row) => sum + parseFloat(row.hours || 0), 0)

  stubRpc("decide_lwop_leave_decision", (args) => {
    const rows = groupRows(args.p_group_id)
    if (rows.length === 0) throw new Error("Leave application not found.")
    if (rows.some((row) => row.status !== "PENDING")) {
      throw new Error("This leave application has already been decided.")
    }
    if (rows[0].head_status && rows[0].head_status !== "APPROVED" && !rows[0].hr_override) {
      throw new Error(
        `Cannot decide this LWOP: the department head has not approved this request yet (head_status=${rows[0].head_status}). Use the HR override if this needs to proceed anyway.`,
      )
    }

    const updated = rows.map((row) =>
      updateRow(table, row, {
        status: args.p_status,
        hr_notes: args.p_hr_notes || null,
        hr_processed_by: args.p_hr_id || null,
        hr_processed_at: new Date().toISOString(),
        approval_hash: "stub-approval-hash",
      }),
    )
    return {
      rows: updated,
      employee_id: rows[0].employee_id,
      total_hours: totalHours(rows),
      dates: updated.map((row) => row.date),
    }
  })

  stubRpc("undo_lwop_leave_decision", (args) => {
    const rows = groupRows(args.p_group_id)
    if (rows.length === 0) throw new Error("Leave application not found.")
    const previousStatus = rows[0].status
    if (previousStatus === "PENDING") throw new Error("Leave is already pending.")

    const updated = rows.map((row) =>
      updateRow(table, row, {
        status: "PENDING",
        hr_notes: null,
        hr_processed_by: null,
        hr_processed_at: null,
        approval_hash: null,
        hr_signature_version: null,
        hr_signature_timestamp: null,
      }),
    )
    return {
      rows: updated,
      employee_id: rows[0].employee_id,
      total_hours: totalHours(rows),
      dates: updated.map((row) => row.date),
      previous_status: previousStatus,
    }
  })

  stubRpc("cancel_lwop_leave", (args) => {
    const clicked = findRow(table, args.p_leave_id)
    if (!clicked) throw new Error("Leave application not found.")
    if (clicked.employee_id !== args.p_employee_id) throw new Error("Unauthorized")
    if (clicked.status === "REJECTED" || clicked.status === "CANCELLED") {
      throw new Error("Cannot withdraw this request.")
    }

    const rows = groupRows(clicked.leave_group_id)
    const firstDate = rows.map((row) => row.date).sort()[0]
    if (clicked.status === "APPROVED" && firstDate < manilaToday()) {
      throw new Error(
        `This leave started on ${firstDate} and has already been taken, so it cannot be withdrawn. Ask HR to undo the approval if the leave was not actually taken.`,
      )
    }

    const updated = rows.map((row) => updateRow(table, row, { status: "CANCELLED" }))
    return {
      rows: updated,
      employee_id: clicked.employee_id,
      group_id: clicked.leave_group_id,
      total_hours: totalHours(rows),
      dates: updated.map((row) => row.date),
      previous_status: clicked.status,
    }
  })
}
