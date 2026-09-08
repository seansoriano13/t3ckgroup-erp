import { supabase } from '../lib/supabase';
import { notificationService } from './notificationService';
import { systemAuditLogService } from './systemAuditLogService';

/**
 * Shared department-head approval stage for sil_leaves, offset_leaves and
 * overtime_requests (issue #137 and sub-issues #138-141).
 *
 * All three tables carry the same head_* columns (see migration
 * 20260908090000_department_head_approval_stage.sql):
 *   head_id, head_status ('PENDING'|'APPROVED'|'REJECTED'), head_note,
 *   head_decided_at, head_signature_version, hr_override
 *
 * so the decision and override paths are written once here instead of once
 * per table. Callers pass the table name and the column/value that scope the
 * request — a single row id for overtime_requests, a leave_group_id for the
 * grouped leave tables.
 */

const TABLE_NOTIFICATION_TYPE = {
  sil_leaves: 'SIL_LEAVE_HEAD_DECISION',
  offset_leaves: 'OFFSET_LEAVE_HEAD_DECISION',
  overtime_requests: 'OVERTIME_HEAD_DECISION',
};

const HEAD_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

/**
 * A request is cleared for HR to decide when the routed head has approved
 * it, or when HR has explicitly overridden the head stage. Every HR-facing
 * decision handler (handleOffsetLeaveDecision, handleSilLeaveDecision,
 * handleOvertimeDecision) must call this before writing an APPROVED-family
 * decision — it is the single place the #137 gating rule lives.
 */
export function assertHeadCleared(row, { action = 'decide this request' } = {}) {
  if (!row) throw new Error('Request not found.');
  const headStatus = row.head_status ?? 'APPROVED';
  const hrOverride = !!row.hr_override;
  if (headStatus === 'APPROVED' || hrOverride) return;
  throw new Error(
    `Cannot ${action}: the department head has not approved this request yet ` +
    `(head_status=${headStatus}). Use the HR override if this needs to proceed anyway.`
  );
}

/** Fetches the row(s) a caller means by (table, matchColumn, matchValue). */
async function fetchRows(table, matchColumn, matchValue) {
  const { data, error } = await supabase.from(table).select('*').eq(matchColumn, matchValue);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('Request not found.');
  return data;
}

/**
 * Records the department head's own decision (APPROVED/REJECTED) on a
 * request routed to them. Only the RLS-permitted actor (the routed head, HR,
 * or a super admin — see guard_head_status_change) can move head_status to
 * APPROVED; this function does not re-check identity beyond what RLS already
 * enforces, matching the rest of the service layer's pattern of trusting the
 * database's own guard.
 */
export async function decideHeadApproval({ table, matchColumn, matchValue, headId, status, headNote }) {
  if (!TABLE_NOTIFICATION_TYPE[table]) throw new Error(`Unsupported table: ${table}`);
  if (!HEAD_STATUSES.includes(status) || status === 'PENDING') {
    throw new Error(`head status must be APPROVED or REJECTED, got ${status}`);
  }

  const rows = await fetchRows(table, matchColumn, matchValue);
  const employeeId = rows[0].employee_id;

  let headSignatureVersion = null;
  if (headId) {
    const { data: head } = await supabase
      .from('employees')
      .select('signature_path')
      .eq('id', headId)
      .single();
    headSignatureVersion = head?.signature_path ?? null;
  }

  const now = new Date().toISOString();
  const { data: updatedRows, error } = await supabase
    .from(table)
    .update({
      head_status: status,
      head_note: headNote || null,
      head_decided_at: now,
      head_signature_version: headSignatureVersion,
      head_id: headId ?? rows[0].head_id,
    })
    .eq(matchColumn, matchValue)
    .select();

  if (error) throw new Error(error.message);

  notificationService.createNotification({
    recipient_id: employeeId,
    sender_id: headId,
    type: TABLE_NOTIFICATION_TYPE[table],
    title: 'Department Head Decision',
    message: `Your request was ${status.toLowerCase()} by the department head.`,
    reference_id: matchValue,
  });

  systemAuditLogService.addApprovalEvent(
    table.toUpperCase(),
    matchValue,
    `Department head ${status.toLowerCase()} the request.`,
    { event: 'HEAD_DECISION', status, employeeId },
    headId,
  ).catch(console.error);

  return updatedRows;
}

/**
 * HR bypassing a missing or rejected head decision. Sets hr_override=true so
 * assertHeadCleared lets the HR decision through, and records who did it and
 * why for the audit trail — this is meant to be the exception, not the norm.
 */
export async function hrOverrideApprove({ table, matchColumn, matchValue, hrId, reason }) {
  if (!TABLE_NOTIFICATION_TYPE[table]) throw new Error(`Unsupported table: ${table}`);

  const rows = await fetchRows(table, matchColumn, matchValue);
  const employeeId = rows[0].employee_id;

  const { data: updatedRows, error } = await supabase
    .from(table)
    .update({ hr_override: true })
    .eq(matchColumn, matchValue)
    .select();

  if (error) throw new Error(error.message);

  systemAuditLogService.addApprovalEvent(
    table.toUpperCase(),
    matchValue,
    `HR overrode the department-head approval stage.${reason ? ` Reason: ${reason}` : ''}`,
    { event: 'HEAD_OVERRIDE', employeeId, reason: reason || null },
    hrId,
  ).catch(console.error);

  return updatedRows;
}

export const headApprovalService = { decideHeadApproval, hrOverrideApprove, assertHeadCleared };
