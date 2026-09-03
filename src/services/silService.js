import { supabase } from '../lib/supabase';
import { notificationService } from './notificationService';
import { systemAuditLogService } from './systemAuditLogService';
import { cleanAttachments, checkOverlap, checkDateTaken, stampApplication, stampApproval } from './offsetService';
import { deriveHours, formatWindow } from '../utils/time';

/**
 * Credits refunded SIL hours back onto an employee's balance, capped at the
 * employee's CURRENT status-appropriate ceiling rather than blindly re-adding
 * on top of whatever HR has set since the leave was approved. Only "Regular"
 * employees are SIL-eligible, so a non-Regular employee's ceiling is 0 — the
 * refund is withheld and flagged as an anomaly for HR to review, instead of
 * silently re-granting hours to someone HR has since made ineligible.
 */
async function creditSilRefund(employeeId, hours, leaveId, actorId) {
  const { data: emp, error: empErr } = await supabase
    .from('employees')
    .select('sil_hours_balance, employment_status, name')
    .eq('id', employeeId)
    .single();

  if (empErr || !emp) return;

  if (emp.employment_status === 'Regular') {
    const newBalance = parseFloat(emp.sil_hours_balance || 0) + parseFloat(hours || 0);
    await supabase
      .from('employees')
      .update({ sil_hours_balance: newBalance, updated_at: new Date().toISOString() })
      .eq('id', employeeId);
    return;
  }

  systemAuditLogService.addSystemEvent(
    'SIL_LEAVE',
    leaveId,
    `SIL refund withheld: ${hours} hrs were NOT credited back to ${emp.name || 'the employee'} because their current employment status ("${emp.employment_status || '—'}") is not SIL-eligible. Review manually if this balance needs correcting.`,
    { event: 'SIL_REFUND_ANOMALY', employeeId, hours, employmentStatus: emp.employment_status },
    actorId,
  ).catch(console.error);
}

export const silService = {
  /**
   * Apply for SIL Leave (Employee)
   */
  async applySilLeave({ employeeId, date, startTime, endTime, reason, categoryId, employeeName, attachments = [] }) {
    const parsedHours = deriveHours(startTime, endTime, false);
    if (parsedHours <= 0) {
      throw new Error('Please enter a valid time window.');
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a reason for the SIL leave.');
    }

    await checkOverlap(employeeId, date, startTime, endTime);

    // Check Employee Balance
    const { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('sil_hours_balance')
      .eq('id', employeeId)
      .single();

    if (empErr) throw new Error(empErr.message);

    const currentBalance = parseFloat(emp.sil_hours_balance || 0);
    if (currentBalance < parsedHours) {
      throw new Error(`Insufficient SIL hours balance. You have ${currentBalance} hrs remaining.`);
    }

    const { applicationHash, employeeSignatureVersion, employeeSignatureTimestamp } = await stampApplication({
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

        const hours = parseFloat(day.hours ?? 8);
        if (!(hours > 0)) throw new Error(`Hours for ${day.date} must be greater than zero.`);

        return { date: day.date, hours };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    for (const day of normalizedDays) {
      await checkDateTaken(employeeId, day.date);
    }

    const totalHours = normalizedDays.reduce((sum, day) => sum + day.hours, 0);

    const { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('sil_hours_balance')
      .eq('id', employeeId)
      .single();

    if (empErr) throw new Error(empErr.message);

    const currentBalance = parseFloat(emp.sil_hours_balance || 0);
    if (currentBalance < totalHours) {
      throw new Error(`Insufficient SIL hours balance. You have ${currentBalance} hrs remaining.`);
    }

    const leaveGroupId = crypto.randomUUID();
    const cleanedAttachments = cleanAttachments(attachments);

    const { applicationHash, employeeSignatureVersion, employeeSignatureTimestamp } = await stampApplication({
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
        employee:employees!sil_leaves_employee_id_fkey(id, name, department, avatar_path, sil_hours_balance),
        hr:employees!sil_leaves_hr_processed_by_fkey(id, name),
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
        employee:employees!sil_leaves_employee_id_fkey(id, name, department, avatar_path, sil_hours_balance)
      `)
      .eq('status', 'PENDING')
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Fetch employee balances overview
   */
  async getEmployeeSilBalances() {
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, department, sub_department, sil_hours_balance, avatar_path')
      .neq('is_deleted', true)
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * HR Decision on a SIL Leave group ('APPROVED', 'REJECTED').
   *
   * Acts on every day-row sharing `groupId` — a single-day application is a
   * group of one, so this is the only decision path callers need. The balance
   * is checked against the group's total hours before anything is written,
   * and the day-rows are updated in one statement, so a range can never end
   * up half-approved.
   */
  async handleSilLeaveDecision({ groupId, status, hrNotes, hrId }) {
    const { data: rows, error: rowsErr } = await supabase
      .from('sil_leaves')
      .select('*')
      .eq('leave_group_id', groupId);

    if (rowsErr) throw new Error(rowsErr.message);
    if (!rows || rows.length === 0) throw new Error('Leave application not found.');

    const employeeId = rows[0].employee_id;
    const applicationHash = rows[0].application_hash;
    const totalHours = rows.reduce((sum, row) => sum + parseFloat(row.hours || 0), 0);
    let creditsSnapshot = null;
    let newBalance = null;

    if (status === 'APPROVED') {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('sil_hours_balance')
        .eq('id', employeeId)
        .single();

      if (empErr) throw new Error(empErr.message);
      const currentBal = parseFloat(emp.sil_hours_balance || 0);

      if (currentBal < totalHours) {
        throw new Error(`Cannot approve leave. Employee currently only has ${currentBal} hrs balance.`);
      }

      // Snapshot the balance the employee will have AFTER this deduction.
      newBalance = currentBal - totalHours;
      creditsSnapshot = newBalance;
    }

    const { approvalHash, hrSignatureVersion, hrSignatureTimestamp } = await stampApproval({
      hrId,
      applicationHash,
      status,
      isDecision: status === 'APPROVED' || status === 'REJECTED',
      creditsSnapshot,
    });
    const now = new Date().toISOString();

    // Row-status write first, balance write second (mirrors offsetService's
    // handleOffsetLeaveDecision): a failure between the two leaves the group
    // PENDING and the balance untouched.
    const { data: updatedRows, error: updateErr } = await supabase
      .from('sil_leaves')
      .update({
        status,
        hr_notes: hrNotes || null,
        hr_processed_by: hrId || null,
        hr_processed_at: now,
        approval_hash: approvalHash,
        hr_signature_version: hrSignatureVersion,
        hr_signature_timestamp: hrSignatureTimestamp,
        approval_credits_snapshot: creditsSnapshot,
      })
      .eq('leave_group_id', groupId)
      .select();

    if (updateErr) throw new Error(updateErr.message);

    if (status === 'APPROVED' && newBalance !== null) {
      await supabase
        .from('employees')
        .update({
          sil_hours_balance: newBalance,
          updated_at: new Date().toISOString(),
        })
        .eq('id', employeeId);
    }

    const dates = rows.map((row) => row.date).sort();
    const rangeLabel = dates.length > 1
      ? `${dates[0]} to ${dates[dates.length - 1]} (${dates.length} days)`
      : dates[0];

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
   * - Refunds the group's total hours if it was APPROVED, capped per employee
   *   rather than per day (see creditSilRefund)
   */
  async undoSilLeaveDecision({ groupId, hrId }) {
    const { data: rows, error: rowsErr } = await supabase
      .from('sil_leaves')
      .select('*')
      .eq('leave_group_id', groupId);

    if (rowsErr) throw new Error(rowsErr.message);
    if (!rows || rows.length === 0) throw new Error('Leave application not found.');

    const status = rows[0].status;
    if (status === 'PENDING') throw new Error('Leave is already pending.');

    const employeeId = rows[0].employee_id;
    const totalHours = rows.reduce((sum, row) => sum + parseFloat(row.hours || 0), 0);

    if (status === 'APPROVED') {
      await creditSilRefund(employeeId, totalHours, groupId, hrId);
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from('sil_leaves')
      .update({
        status: 'PENDING',
        hr_notes: null,
        hr_processed_by: null,
        hr_processed_at: null,
        approval_hash: null,
        hr_signature_version: null,
        hr_signature_timestamp: null,
        approval_credits_snapshot: null,
      })
      .eq('leave_group_id', groupId)
      .select();

    if (updateErr) throw new Error(updateErr.message);

    const dates = rows.map((row) => row.date).sort();
    const dateLabel = dates.length > 1 ? `${dates[0]} to ${dates[dates.length - 1]}` : dates[0];

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
      `SIL leave decision for ${dateLabel} was reverted to PENDING (was ${status}).`,
      { event: 'SIL_LEAVE_DECISION_UNDONE', previousStatus: status, employeeId, leaveGroupId: groupId },
      hrId,
    ).catch(console.error);

    return updatedRows;
  },

  /**
   * Cancel own SIL Leave application (Employee).
   *
   * Operates on the whole leave_group_id, not just the clicked row, mirroring
   * withdrawOffsetLeave's group-atomic pattern — a date-range leave is
   * cancelled and refunded as one group, never partially.
   */
  async cancelMySilLeave({ leaveId, employeeId }) {
    const { data: clicked, error: clickedErr } = await supabase
      .from('sil_leaves')
      .select('*')
      .eq('id', leaveId)
      .single();

    if (clickedErr) throw new Error(clickedErr.message);
    if (clicked.employee_id !== employeeId) throw new Error('Unauthorized');

    const { data: rows, error: rowsErr } = await supabase
      .from('sil_leaves')
      .select('*')
      .eq('leave_group_id', clicked.leave_group_id);

    if (rowsErr) throw new Error(rowsErr.message);

    const totalHours = rows.reduce((sum, row) => sum + parseFloat(row.hours || 0), 0);
    const dates = rows.map((row) => row.date).sort();
    const dateLabel = dates.length > 1 ? `${dates[0]} to ${dates[dates.length - 1]}` : dates[0];

    const { data: updatedRows, error: updateErr } = await supabase
      .from('sil_leaves')
      .update({
        status: 'CANCELLED',
      })
      .eq('leave_group_id', clicked.leave_group_id)
      .select();

    if (updateErr) throw new Error(updateErr.message);

    // Only pending or approved leaves in the future can be cancelled by employee
    // To be safe, let's refund if it was approved (capped — see creditSilRefund)
    if (clicked.status === 'APPROVED') {
      await creditSilRefund(employeeId, totalHours, clicked.leave_group_id, employeeId);
    }

    // Notify HR
    notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
      sender_id: employeeId,
      type: 'SIL_LEAVE_CANCELLED',
      title: 'SIL Leave Cancelled',
      message: `An employee cancelled their SIL leave for ${totalHours} hrs (${dateLabel}).`,
      reference_id: clicked.leave_group_id,
    });

    systemAuditLogService.addSystemEvent(
      'SIL_LEAVE',
      clicked.leave_group_id,
      `SIL leave for ${dateLabel} was cancelled by the employee.`,
      { event: 'SIL_LEAVE_CANCELLED', employeeId, leaveGroupId: clicked.leave_group_id },
      employeeId,
    ).catch(console.error);

    return updatedRows;
  },
};
