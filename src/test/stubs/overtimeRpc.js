import { stubRpc } from "@/test/msw/server"
import { db, updateRow } from "@/test/db/store"

const findRow = (table, id) => db.internal.rowsOf(table).find((row) => row.id === id)

/**
 * `decide_overtime_request` / `undo_overtime_decision` (issue #108, ADR 0013)
 * live in Postgres, which the fake database does not execute — so this
 * re-implements their logic in JS against the same in-memory store, the
 * pattern `purchasingService.test.js` established for
 * `sor_raise_procurement_task`. Shared between `offsetService.test.js` and
 * any component test that exercises an overtime decision (e.g.
 * `ApproveOvertimeModal.test.jsx`) so the two never drift apart.
 *
 * Because the stub body never awaits mid-computation, two calls fired
 * concurrently still each run to completion before the next one starts —
 * the same atomicity a real `FOR UPDATE` lock gives in production.
 */
export function stubOvertimeDecisionRpcs() {
  stubRpc("decide_overtime_request", (args) => {
    const request = findRow("overtime_requests", args.p_request_id)
    if (!request) throw new Error("Overtime request not found.")

    const isApproval = args.p_status === "APPROVED_OFFSET" || args.p_status === "APPROVED_PAID"
    const isDecision = isApproval || args.p_status === "REJECTED"
    const approvedHours = isApproval ? parseFloat(args.p_approved_hours ?? request.hours) : null

    if (isApproval && !(approvedHours > 0)) {
      throw new Error("Approved hours must be greater than zero.")
    }

    let creditsSnapshot = null
    if (args.p_status === "APPROVED_OFFSET") {
      const emp = findRow("employees", request.employee_id)
      creditsSnapshot = parseFloat(emp.offset_hours_balance || 0) + approvedHours
      updateRow("employees", emp, { offset_hours_balance: creditsSnapshot })
    }

    return updateRow("overtime_requests", request, {
      status: args.p_status,
      approved_hours: approvedHours,
      hr_notes: args.p_hr_notes || null,
      approval_hash: isDecision ? "stub-approval-hash" : null,
      hr_signature_version: null,
      hr_signature_timestamp: null,
      approval_credits_snapshot: creditsSnapshot,
      hr_processed_by: args.p_hr_id || null,
    })
  })

  stubRpc("undo_overtime_decision", (args) => {
    const request = findRow("overtime_requests", args.p_request_id)
    if (!request) throw new Error("Overtime request not found.")
    if (request.status === "PENDING") throw new Error("Request is already pending.")

    if (request.status === "APPROVED_OFFSET") {
      const creditedHours = parseFloat(request.approved_hours ?? request.hours ?? 0)
      const emp = findRow("employees", request.employee_id)
      const currentBalance = parseFloat(emp.offset_hours_balance || 0)
      const newBalance = currentBalance - creditedHours

      if (newBalance < 0) {
        throw new Error(
          `Cannot undo: this would deduct ${creditedHours} hrs, but only ${currentBalance} hrs remain on the balance.`,
        )
      }

      updateRow("employees", emp, { offset_hours_balance: newBalance })
    }

    return updateRow("overtime_requests", request, {
      status: "PENDING",
      approved_hours: null,
      hr_notes: null,
      approval_hash: null,
      hr_signature_version: null,
      hr_signature_timestamp: null,
      approval_credits_snapshot: null,
      hr_processed_by: null,
    })
  })
}
