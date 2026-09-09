import { supabase } from '../lib/supabase';
import { notificationService } from './notificationService';
import { systemAuditLogService } from './systemAuditLogService';
import { cleanAttachments, checkOverlap, checkDateTaken, stampApplication } from './offsetService';
import { describeLeaveRange, formatWindow } from '../utils/time';
import { assertNotWeekend, applyLunchDeduction, deriveLeaveHours, assertSilEligible, assertWithinAvailableBalance } from './leaveRules';
import { assertHeadCleared } from './headApprovalService';

/**
 * Loads the fields every SIL apply/approve path needs, and enforces
 * eligibility right there — so no caller can read the balance without also
 * checking employment status.
 */
async function fetchEligibleSilEmployee(employeeId) {
  const { data: emp, error: empErr } = await supabase
    .from('employees')
    .select('sil_hours_balance, employment_status')
    .eq('id', employeeId)
    .single();

  if (empErr) throw new Error(empErr.message);

  assertSilEligible(emp.employment_status);

  return emp;
}

/**
 * Records the anomaly a withheld SIL refund leaves behind.
 *
 * The refund itself is a gate, not a cap, and it now lives inside the decision
 * functions (see the atomic-SIL-leave migration): a SIL-eligible ("Regular")
 * employee gets the full amount back, and anyone else gets none, because
 * silently re-granting hours to someone HR has since made ineligible is worse
 * than a balance HR must correct by hand. This audit line is the only signal
 * HR gets that such a correction is needed, so it is written from here, where
 * every other SIL audit line is written, off the `refund_withheld` flag the
 * function reports back.
 */
function recordWithheldRefund(result, referenceId, actorId) {
  if (!result?.refund_withheld) return;

  const hours = result.total_hours;
  systemAuditLogService.addSystemEvent(
    'SIL_LEAVE',
    referenceId,
    `SIL refund withheld: ${hours} hrs were NOT credited back to ${result.employee_name || 'the employee'} because their current employment status ("${result.employment_status || '—'}") is not SIL-eligible. Review manually if this balance needs correcting.`,
    { event: 'SIL_REFUND_ANOMALY', employeeId: result.employee_id, hours, employmentStatus: result.employment_status },
    actorId,
  ).catch(console.error);
}

/**
 * Hours the employee has already committed to SIL leaves still awaiting an
 * HR decision — see offsetService.getPendingOffsetHours for why this can't
 * be read off the stored balance directly.
 */
async function getPendingSilHours(employeeId) {
  const { data, error } = await supabase
    .from('sil_leaves')
    .select('hours')
    .eq('employee_id', employeeId)
    .eq('status', 'PENDING');

  if (error) throw new Error(error.message);
  return (data || []).reduce((sum, row) => sum + parseFloat(row.hours || 0), 0);
}

export const silService = {
  /**
   * Apply for SIL Leave (Employee)
   */
  async applySilLeave({ employeeId, date, startTime, endTime, reason, categoryId, employeeName, attachments = [], headId }) {
    const parsedHours = deriveLeaveHours(startTime, endTime);
    if (parsedHours <= 0) {
      throw new Error('Please enter a valid time window.');
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a reason for the SIL leave.');
    }

    await checkOverlap(employeeId, date, startTime, endTime);

    assertNotWeekend(date);

    const emp = await fetchEligibleSilEmployee(employeeId);
    const currentBalance = parseFloat(emp.sil_hours_balance || 0);
    const pendingHours = await getPendingSilHours(employeeId);
    assertWithinAvailableBalance({ currentBalance, pendingHours, requestedHours: parsedHours, leaveTypeLabel: 'SIL' });

    const { applicationHash, employeeSignatureVersion, employeeSignatureTimestamp, companyId } = await stampApplication({
      employeeId,
      categoryId,
      dates: [date],
      totalHours: parsedHours,
      reason,
    });

    const { data, error } = await supabase
      .from('sil_leaves')
      .insert([
        {
          employee_id: employeeId,
          date,
          start_time: startTime,
          end_time: endTime,
          hours: parsedHours,
          reason,
          category_id: categoryId || null,
          status: 'PENDING',
          attachments: cleanAttachments(attachments),
          application_hash: applicationHash,
          employee_signature_version: employeeSignatureVersion,
          employee_signature_timestamp: employeeSignatureTimestamp,
          head_id: headId || null,
          head_status: headId ? 'PENDING' : 'APPROVED',
          company_id: companyId,
        },
      ])
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Notify HR
    notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
      sender_id: employeeId,
      type: 'SIL_LEAVE_REQUEST',
      title: 'New SIL Leave Request',
      message: `${employeeName || 'An employee'} applied for ${parsedHours} hrs SIL leave (${formatWindow(startTime, endTime)}) on ${date}.`,
      reference_id: data.id,
    });

    systemAuditLogService.addSystemEvent(
      'SIL_LEAVE',
      data.id,
      `${employeeName || 'An employee'} applied for ${parsedHours} hrs SIL leave (${formatWindow(startTime, endTime)}) on ${date}.`,
      { event: 'SIL_LEAVE_APPLIED', employeeId },
      employeeId,
    ).catch(console.error);

    return data;
  },

  /**
   * Apply for SIL Leave across a date range (Employee).
   *
   * Writes one row per day under a shared `leave_group_id`, mirroring
   * `offsetService.applyOffsetLeaveRange` — see that function for why a group
   * of day-rows was chosen over an end-date column. `days` is
   * `[{ date, hours }]`; the apply form defaults each day to 8 hours.
   */
  async applySilLeaveRange({ employeeId, days, reason, categoryId, employeeName, attachments = [] }) {
    if (!Array.isArray(days) || days.length === 0) {
      throw new Error('Please select at least one day.');
    }
    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a reason for the SIL leave.');
    }

    const seenDates = new Set();
    const normalizedDays = days
      .map((day) => {
        if (seenDates.has(day.date)) throw new Error(`${day.date} was listed more than once.`);
        seenDates.add(day.date);

        const rawHours = parseFloat(day.hours ?? 8);
        if (!(rawHours > 0)) throw new Error(`Hours for ${day.date} must be greater than zero.`);

        assertNotWeekend(day.date, day.date);

        return { date: day.date, hours: applyLunchDeduction(rawHours) };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    for (const day of normalizedDays) {
      await checkDateTaken(employeeId, day.date);
    }

    const totalHours = normalizedDays.reduce((sum, day) => sum + day.hours, 0);

    const emp = await fetchEligibleSilEmployee(employeeId);
    const currentBalance = parseFloat(emp.sil_hours_balance || 0);
    const pendingHours = await getPendingSilHours(employeeId);
    assertWithinAvailableBalance({ currentBalance, pendingHours, requestedHours: totalHours, leaveTypeLabel: 'SIL' });

    const leaveGroupId = crypto.randomUUID();
    const cleanedAttachments = cleanAttachments(attachments);

    const { applicationHash, employeeSignatureVersion, employeeSignatureTimestamp, companyId } = await stampApplication({
      employeeId,
      categoryId,
      dates: normalizedDays.map((d) => d.date),
      totalHours,
      reason,
    });

    const { data, error } = await supabase
      .from('sil_leaves')
      .insert(normalizedDays.map((day) => ({
        employee_id: employeeId,
        date: day.date,
        hours: day.hours,
        reason,
        category_id: categoryId || null,
        status: 'PENDING',
        attachments: cleanedAttachments,
        leave_group_id: leaveGroupId,
        application_hash: applicationHash,
        employee_signature_version: employeeSignatureVersion,
        employee_signature_timestamp: employeeSignatureTimestamp,
        company_id: companyId,
      })))
      .select();

    if (error) throw new Error(error.message);

    const rangeLabel = normalizedDays.length > 1
      ? `${normalizedDays[0].date} to ${normalizedDays[normalizedDays.length - 1].date} (${normalizedDays.length} days)`
      : normalizedDays[0].date;

    notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
      sender_id: employeeId,
      type: 'SIL_LEAVE_REQUEST',
      title: 'New SIL Leave Request',
      message: `${employeeName || 'An employee'} applied for ${totalHours} hrs SIL leave (${rangeLabel}).`,
      reference_id: leaveGroupId,
    });

    systemAuditLogService.addSystemEvent(
      'SIL_LEAVE',
      leaveGroupId,
      `${employeeName || 'An employee'} applied for ${totalHours} hrs SIL leave (${rangeLabel}).`,
      { event: 'SIL_LEAVE_APPLIED', employeeId, leaveGroupId },
      employeeId,
    ).catch(console.error);

    return data;
  },

  /**
   * Get employee's own SIL leave applications
   */
  async getMySilLeaves(employeeId, startDate = null, endDate = null) {
    let query = supabase
      .from('sil_leaves')
      .select(`
        *,
        category:hr_leave_categories(label)
      `)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lt('date', endDate);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Get employee's own pending SIL leaves (dateless)
   */
  async getMyPendingSilLeaves(employeeId) {
    const { data, error } = await supabase
      .from('sil_leaves')
      .select(`
        *,
        category:hr_leave_categories(label)
      `)
      .eq('employee_id', employeeId)
      .eq('status', 'PENDING')
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Fetch all SIL leave applications (HR)
   * Also used by all employees to view the calendar (RLS allows viewing APPROVED leaves)
   */
  async getAllSilLeaves(startDate = null, endDate = null) {
    let query = supabase
      .from('sil_leaves')
      .select(`
        *,
        employee:employees!sil_leaves_employee_id_fkey(id, name, role, department, sub_department, employment_status, avatar_path, sil_hours_balance, signature_path),
        hr:employees!sil_leaves_hr_processed_by_fkey(id, name, signature_path),
        head:employees!sil_leaves_head_id_fkey(id, name, signature_path),
        category:hr_leave_categories(label),
        company:companies(id, name)
      `)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lt('date', endDate);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Fetch approved SIL leaves for the shared calendar — employee view.
   *
   * Projects only the fields the calendar needs (person, date, type, time
   * window). Reason, hours balance, and signature path are omitted at the
   * query level so they never reach a non-HR browser. HR uses getAllSilLeaves
   * instead. See ADR 0012.
   */
  async getCalendarSilLeaves(startDate = null, endDate = null) {
    let query = supabase
      .from('sil_leaves')
      .select(`
        id, employee_id, date, start_time, end_time, hours, status, leave_group_id,
        employee:employees!sil_leaves_employee_id_fkey(id, name, department, avatar_path),
        category:hr_leave_categories(label)
      `)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lt('date', endDate);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Fetch all pending SIL leaves across all time (HR)
   */
  async getAllPendingSilLeaves() {
    const { data, error } = await supabase
      .from('sil_leaves')
      .select(`
        *,
        employee:employees!sil_leaves_employee_id_fkey(id, name, role, department, sub_department, employment_status, avatar_path, sil_hours_balance),
        company:companies(id, name)
      `)
      .eq('status', 'PENDING')
      .or('head_status.eq.APPROVED,hr_override.eq.true')
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Hours already committed to the employee's own pending SIL leaves —
   * exposed for the apply forms and pending queue (issue #106).
   */
  getPendingSilHours,

  /**
   * Fetch employee balances overview
   */
  async getEmployeeSilBalances() {
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, department, sub_department, sil_hours_balance, avatar_path, company:companies(id, name)')
      .neq('is_deleted', true)
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * HR Decision on a SIL Leave group ('APPROVED', 'REJECTED').
   *
   * Acts on every day-row sharing `groupId` — a single-day application is a
   * group of one, so this is the only decision path callers need.
   *
   * The day-rows, the balance deduction, the eligibility re-check and the
   * approval hash/HR-signature stamp all happen inside one Postgres function
   * (`decide_sil_leave_decision`, see the atomic-SIL-leave migration and ADR
   * 0013), which holds every day-row and the employee row locked while it
   * works. A range can never be observed half-decided, and two officers
   * deciding for one employee cannot race each other into losing a balance
   * movement.
   */
  async handleSilLeaveDecision({ groupId, status, hrNotes, hrId }) {
    // See handleOffsetLeaveDecision's matching comment: decide_sil_leave_decision
    // does not yet gate on head_status itself, so this pre-read/assertHeadCleared
    // call is the accepted interim pattern, with the same narrow race window a
    // future migration should close.
    if (status === 'APPROVED') {
      const { data: gateRow, error: gateErr } = await supabase
        .from('sil_leaves')
        .select('head_status, hr_override')
        .eq('leave_group_id', groupId)
        .limit(1)
        .maybeSingle();

      if (gateErr) throw new Error(gateErr.message);
      if (!gateRow) throw new Error('Leave application not found.');
      assertHeadCleared(gateRow, { action: 'approve this SIL leave' });
    }

    const { data: result, error } = await supabase.rpc('decide_sil_leave_decision', {
      p_group_id: groupId,
      p_status: status,
      p_hr_notes: hrNotes || null,
      p_hr_id: hrId || null,
    });

    if (error) throw new Error(error.message);

    const { rows: updatedRows, employee_id: employeeId, total_hours: totalHours } = result;
    const rangeLabel = describeLeaveRange(result.dates, { withDayCount: true });

    notificationService.createNotification({
      recipient_id: employeeId,
      sender_id: hrId,
      type: 'SIL_LEAVE_DECISION',
      title: 'SIL Leave Application Status',
      message: `Your SIL leave application for ${totalHours} hrs (${rangeLabel}) was ${status.toLowerCase()}.`,
      reference_id: groupId,
    });

    systemAuditLogService.addApprovalEvent(
      'SIL_LEAVE',
      groupId,
      `SIL leave application for ${totalHours} hrs (${rangeLabel}) was ${status.toLowerCase()}.`,
      { event: 'SIL_LEAVE_DECISION', status, employeeId, leaveGroupId: groupId },
      hrId,
    ).catch(console.error);

    return updatedRows;
  },

  /**
   * Undo HR's decision on a SIL Leave group.
   * - Reverts every day-row in the group to PENDING
   * - Refunds the group's total hours if it was APPROVED and the employee is
   *   still SIL-eligible; otherwise the refund is withheld and recorded as an
   *   anomaly (see recordWithheldRefund)
   */
  async undoSilLeaveDecision({ groupId, hrId }) {
    const { data: result, error } = await supabase.rpc('undo_sil_leave_decision', {
      p_group_id: groupId,
      p_hr_id: hrId || null,
    });

    if (error) throw new Error(error.message);

    const { rows: updatedRows, employee_id: employeeId, previous_status: previousStatus } = result;
    const dateLabel = describeLeaveRange(result.dates);

    recordWithheldRefund(result, groupId, hrId);

    notificationService.createNotification({
      recipient_id: employeeId,
      sender_id: hrId,
      type: 'SIL_LEAVE_DECISION',
      title: 'SIL Leave Request Reverted',
      message: `HR has reverted the decision on your SIL leave request for ${dateLabel}. It is now PENDING again.`,
      reference_id: groupId,
    });

    systemAuditLogService.addSystemEvent(
      'SIL_LEAVE',
      groupId,
      `SIL leave decision for ${dateLabel} was reverted to PENDING (was ${previousStatus}).`,
      { event: 'SIL_LEAVE_DECISION_UNDONE', previousStatus, employeeId, leaveGroupId: groupId },
      hrId,
    ).catch(console.error);

    return updatedRows;
  },

  /**
   * Cancel own SIL Leave application (Employee).
   *
   * Operates on the whole leave_group_id, not just the clicked row, mirroring
   * withdrawOffsetLeave's group-atomic pattern — a date-range leave is
   * cancelled and refunded as one group, never partially. `cancel_sil_leave`
   * reads the group's status under the same lock it writes through, so an HR
   * decision landing mid-cancellation cannot leave a CANCELLED leave with its
   * hours still deducted.
   */
  async cancelMySilLeave({ leaveId, employeeId }) {
    const { data: result, error } = await supabase.rpc('cancel_sil_leave', {
      p_leave_id: leaveId,
      p_employee_id: employeeId,
    });

    if (error) throw new Error(error.message);

    const { rows: updatedRows, group_id: groupId, total_hours: totalHours } = result;
    const dateLabel = describeLeaveRange(result.dates);

    recordWithheldRefund(result, groupId, employeeId);

    // Notify HR
    notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
      sender_id: employeeId,
      type: 'SIL_LEAVE_CANCELLED',
      title: 'SIL Leave Cancelled',
      message: `An employee cancelled their SIL leave for ${totalHours} hrs (${dateLabel}).`,
      reference_id: groupId,
    });

    systemAuditLogService.addSystemEvent(
      'SIL_LEAVE',
      groupId,
      `SIL leave for ${dateLabel} was cancelled by the employee.`,
      { event: 'SIL_LEAVE_CANCELLED', employeeId, leaveGroupId: groupId },
      employeeId,
    ).catch(console.error);

    return updatedRows;
  },

  /**
   * Stamp a printed batch's SIL leaves as printed (Document Center).
   * Informational only — never blocks a later reprint. Mirrors
   * offsetService.markOffsetLeavesPrinted's group-or-id shape.
   */
  async markSilLeavesPrinted({ id, groupId, hrId }) {
    const query = supabase
      .from('sil_leaves')
      .update({ printed_at: new Date().toISOString(), printed_by: hrId });

    const { error } = groupId ? await query.eq('leave_group_id', groupId) : await query.eq('id', id);
    if (error) throw new Error(error.message);
  },
};
