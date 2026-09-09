import { stubRpc } from "@/test/msw/server"
import { db, updateRow } from "@/test/db/store"

const findRow = (table, id) => db.internal.rowsOf(table).find((row) => row.id === id)

/**
 * `decide_undertime_request` / `undo_undertime_decision` (issues #147-149, see
 * 20260909010000_undertime_requests.sql) live in Postgres, so this
 * re-implements their logic in JS against the same in-memory store, mirroring
 * `overtimeRpc.js`'s stub — but with no APPROVED_OFFSET branch at all:
 * undertime never touches offset_hours_balance or sil_hours_balance, on any
 * status. It also stamps hr_processed_at, a column overtime's stub has no
 * equivalent for.
 */
export function stubUndertimeDecisionRpcs() {
  stubRpc("decide_undertime_request", (args) => {
    const request = findRow("undertime_requests", args.p_request_id)
    if (!request) throw new Error("Undertime request not found.")

    const isApproval = args.p_status === "APPROVED"
    const isDecision = isApproval || args.p_status === "REJECTED"
    const approvedHours = isApproval ? parseFloat(args.p_approved_hours ?? request.hours) : request.approved_hours ?? null

    const headStatus = request.head_status ?? "APPROVED"
    if (isApproval && headStatus !== "APPROVED" && !request.hr_override) {
      throw new Error(
        `Cannot approve this undertime request: the department head has not approved this request yet (head_status=${headStatus}). Use the HR override if this needs to proceed anyway.`,
      )
    }

    if (isApproval && !(approvedHours > 0)) {
      throw new Error("Approved hours must be greater than zero.")
    }

    return updateRow("undertime_requests", request, {
      status: args.p_status,
      approved_hours: approvedHours,
      hr_notes: args.p_hr_notes || null,
      approval_hash: isDecision ? "stub-approval-hash" : request.approval_hash,
      hr_signature_version: request.hr_signature_version,
      hr_signature_timestamp: request.hr_signature_timestamp,
      hr_processed_by: args.p_hr_id || null,
      hr_processed_at: isDecision ? new Date().toISOString() : request.hr_processed_at,
    })
  })

  stubRpc("undo_undertime_decision", (args) => {
    const request = findRow("undertime_requests", args.p_request_id)
    if (!request) throw new Error("Undertime request not found.")
    if (request.status === "PENDING") throw new Error("Request is already pending.")

    return updateRow("undertime_requests", request, {
      status: "PENDING",
      approved_hours: null,
      hr_notes: null,
      approval_hash: null,
      hr_signature_version: null,
      hr_signature_timestamp: null,
      hr_processed_by: null,
      hr_processed_at: null,
    })
  })
}
