import { supabase } from '../lib/supabase';
import { notificationService } from './notificationService';
import { systemAuditLogService } from './systemAuditLogService';
import { deriveHours, formatWindow, windowsOverlap } from '../utils/time';

/**
 * Keeps only usable Cloudinary descriptors, and stores null rather than an
 * empty array so "no attachments" reads the same on old and new rows.
 */
export function cleanAttachments(attachments) {
  const files = (attachments || []).filter((a) => a?.url);
  return files.length > 0 ? files : null;
}

export async function checkOverlap(employeeId, date, startTime, endTime) {
  const [ot, offset, sil] = await Promise.all([
    supabase.from('overtime_requests').select('start_time, end_time').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
    supabase.from('offset_leaves').select('start_time, end_time').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
    supabase.from('sil_leaves').select('start_time, end_time').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")')
  ]);

  const allExisting = [
    ...(ot.data || []),
    ...(offset.data || []),
    ...(sil.data || [])
  ].filter(r => r.start_time && r.end_time);

  if (allExisting.some(r => windowsOverlap({start: startTime, end: endTime}, {start: r.start_time, end: r.end_time}))) {
    throw new Error('This time window overlaps with an existing application on this date.');
  }
}

/**
 * A full-day range application (see `applyOffsetLeaveRange` / `applySilLeaveRange`)
 * carries no time window, so `checkOverlap`'s window comparison can't tell whether
 * it collides with something else on the same date. Without a window to compare,
 * any other active application on that date is treated as a conflict.
 */
export async function checkDateTaken(employeeId, date) {
  const [ot, offset, sil] = await Promise.all([
    supabase.from('overtime_requests').select('id').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
    supabase.from('offset_leaves').select('id').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
    supabase.from('sil_leaves').select('id').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
  ]);

  if ([...(ot.data || []), ...(offset.data || []), ...(sil.data || [])].length > 0) {
    throw new Error(`An application already exists on ${date}.`);
  }
}

export const offsetService = {
  /**
   * Apply for Overtime (Employee)
   */
  async applyOvertime({ employeeId, date, startTime, endTime, reason, employeeName, attachments = [] }) {
    const parsedHours = deriveHours(startTime, endTime, true);
    if (parsedHours <= 0) {
      throw new Error('Please enter a valid time window.');
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a reason for the overtime request.');
    }

    await checkOverlap(employeeId, date, startTime, endTime);

    const { data, error } = await supabase
      .from('overtime_requests')
      .insert([
        {
          employee_id: employeeId,
          date,
          start_time: startTime,
          end_time: endTime,
          hours: parsedHours,
          reason,
          status: 'PENDING',
          attachments: cleanAttachments(attachments),
        },
      ])
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Notify HR
    notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
      sender_id: employeeId,
      type: 'OVERTIME_REQUEST',
      title: 'New Overtime Application',
      message: `${employeeName || 'An employee'} applied for ${parsedHours} hrs of overtime (${formatWindow(startTime, endTime)}) on ${date}.`,
      reference_id: data.id,
    });

    systemAuditLogService.addSystemEvent(
      'OVERTIME',
      data.id,
      `${employeeName || 'An employee'} applied for ${parsedHours} hrs of overtime (${formatWindow(startTime, endTime)}) on ${date}.`,
      { event: 'OVERTIME_APPLIED', employeeId },
      employeeId,
    ).catch(console.error);

    return data;
  },

  /**
   * Apply for Offset Leave (Employee)
   */
  async applyOffsetLeave({ employeeId, date, startTime, endTime, reason, employeeName, attachments = [] }) {
    const parsedHours = deriveHours(startTime, endTime, false);
    if (parsedHours <= 0) {
      throw new Error('Please enter a valid time window.');
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a reason for the offset leave.');
    }

    await checkOverlap(employeeId, date, startTime, endTime);

    // Check Weekend
    const reqDate = new Date(date);
    const day = reqDate.getUTCDay();
    if (day === 0 || day === 6) {
      throw new Error('Offset leaves cannot be applied on weekends (Saturday / Sunday).');
    }

    // Check Employee Balance
    const { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('offset_hours_balance')
      .eq('id', employeeId)
      .single();

    if (empErr) throw new Error(empErr.message);

    const currentBalance = parseFloat(emp.offset_hours_balance || 0);
    if (currentBalance < parsedHours) {
      throw new Error(`Insufficient offset hours balance. You have ${currentBalance} hrs remaining.`);
    }

    const { data, error } = await supabase
      .from('offset_leaves')
      .insert([
        {
          employee_id: employeeId,
          date,
          start_time: startTime,
          end_time: endTime,
          hours: parsedHours,
          reason,
          status: 'PENDING',
          attachments: cleanAttachments(attachments),
        },
      ])
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Notify HR
    notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
      sender_id: employeeId,
      type: 'OFFSET_LEAVE_REQUEST',
      title: 'New Offset Leave Request',
      message: `${employeeName || 'An employee'} applied for ${parsedHours} hrs offset leave (${formatWindow(startTime, endTime)}) on ${date}.`,
      reference_id: data.id,
    });

    systemAuditLogService.addSystemEvent(
      'OFFSET_LEAVE',
      data.id,
      `${employeeName || 'An employee'} applied for ${parsedHours} hrs offset leave (${formatWindow(startTime, endTime)}) on ${date}.`,
      { event: 'OFFSET_LEAVE_APPLIED', employeeId },
      employeeId,
    ).catch(console.error);

    return data;
  },

  /**
   * Apply for Offset Leave across a date range (Employee).
   *
   * Writes one row per day under a shared `leave_group_id` rather than a
   * single row with an end date, so the calendar and month-boundary date
   * queries — which both assume one row is one day — keep working unchanged.
   * `days` is `[{ date, hours }]`; the caller (the apply form) is responsible
   * for defaulting each day to 8 hours and letting HR-visible edits narrow a
   * half-day inside the range.
   */
  async applyOffsetLeaveRange({ employeeId, days, reason, employeeName, attachments = [] }) {
    if (!Array.isArray(days) || days.length === 0) {
      throw new Error('Please select at least one day.');
    }
    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a reason for the offset leave.');
    }

    const seenDates = new Set();
    const normalizedDays = days
      .map((day) => {
        if (seenDates.has(day.date)) throw new Error(`${day.date} was listed more than once.`);
        seenDates.add(day.date);

        const hours = parseFloat(day.hours ?? 8);
        if (!(hours > 0)) throw new Error(`Hours for ${day.date} must be greater than zero.`);

        const weekday = new Date(day.date).getUTCDay();
        if (weekday === 0 || weekday === 6) {
          throw new Error(`Offset leaves cannot be applied on weekends (Saturday / Sunday): ${day.date}.`);
        }

        return { date: day.date, hours };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    for (const day of normalizedDays) {
      await checkDateTaken(employeeId, day.date);
    }

    const totalHours = normalizedDays.reduce((sum, day) => sum + day.hours, 0);

    const { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('offset_hours_balance')
      .eq('id', employeeId)
      .single();

    if (empErr) throw new Error(empErr.message);

    const currentBalance = parseFloat(emp.offset_hours_balance || 0);
    if (currentBalance < totalHours) {
      throw new Error(`Insufficient offset hours balance. You have ${currentBalance} hrs remaining.`);
    }

    const leaveGroupId = crypto.randomUUID();
    const cleanedAttachments = cleanAttachments(attachments);

    const { data, error } = await supabase
      .from('offset_leaves')
      .insert(normalizedDays.map((day) => ({
        employee_id: employeeId,
        date: day.date,
        hours: day.hours,
        reason,
        status: 'PENDING',
        attachments: cleanedAttachments,
        leave_group_id: leaveGroupId,
      })))
      .select();

    if (error) throw new Error(error.message);

    const rangeLabel = normalizedDays.length > 1
      ? `${normalizedDays[0].date} to ${normalizedDays[normalizedDays.length - 1].date} (${normalizedDays.length} days)`
      : normalizedDays[0].date;

    notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
      sender_id: employeeId,
      type: 'OFFSET_LEAVE_REQUEST',
      title: 'New Offset Leave Request',
      message: `${employeeName || 'An employee'} applied for ${totalHours} hrs offset leave (${rangeLabel}).`,
      reference_id: leaveGroupId,
    });

    systemAuditLogService.addSystemEvent(
      'OFFSET_LEAVE',
      leaveGroupId,
      `${employeeName || 'An employee'} applied for ${totalHours} hrs offset leave (${rangeLabel}).`,
      { event: 'OFFSET_LEAVE_APPLIED', employeeId, leaveGroupId },
      employeeId,
    ).catch(console.error);

    return data;
  },

  /**
   * Get employee's own overtime requests
   */
  async getMyOvertimeRequests(employeeId, startDate = null, endDate = null) {
    let query = supabase
      .from('overtime_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lt('date', endDate);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Get employee's own pending overtime requests (dateless)
   */
  async getMyPendingOvertimeRequests(employeeId) {
    const { data, error } = await supabase
      .from('overtime_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('status', 'PENDING')
      .order('date', { ascending: true }); // Ordered by date ascending for the queue

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Get employee's own offset leave applications
   */
  async getMyOffsetLeaves(employeeId, startDate = null, endDate = null) {
    let query = supabase
      .from('offset_leaves')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lt('date', endDate);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Get employee's own pending offset leaves (dateless)
   */
  async getMyPendingOffsetLeaves(employeeId) {
    const { data, error } = await supabase
      .from('offset_leaves')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('status', 'PENDING')
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Fetch all overtime requests (HR)
   */
  async getAllOvertimeRequests(startDate = null, endDate = null) {
    let query = supabase
      .from('overtime_requests')
      .select(`
        *,
        employee:employees!overtime_requests_employee_id_fkey(id, name, department, avatar_path, offset_hours_balance)
      `)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lt('date', endDate);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Fetch all pending overtime requests across all time (HR)
   */
  async getAllPendingOvertimeRequests() {
    const { data, error } = await supabase
      .from('overtime_requests')
      .select(`
        *,
        employee:employees!overtime_requests_employee_id_fkey(id, name, department, avatar_path, offset_hours_balance)
      `)
      .eq('status', 'PENDING')
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Fetch all offset leave applications (HR)
   * Also used by all employees to view the calendar (RLS allows viewing APPROVED leaves)
   */
  async getAllOffsetLeaves(startDate = null, endDate = null) {
    let query = supabase
      .from('offset_leaves')
      .select(`
        *,
        employee:employees!offset_leaves_employee_id_fkey(id, name, department, avatar_path, offset_hours_balance)
      `)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lt('date', endDate);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Fetch all pending offset leaves across all time (HR)
   */
  async getAllPendingOffsetLeaves() {
    const { data, error } = await supabase
      .from('offset_leaves')
      .select(`
        *,
        employee:employees!offset_leaves_employee_id_fkey(id, name, department, avatar_path, offset_hours_balance)
      `)
      .eq('status', 'PENDING')
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Fetch employee balances overview
   */
  async getEmployeeOffsetBalances() {
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, department, sub_department, offset_hours_balance, avatar_path')
      .neq('is_deleted', true)
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * HR Decision on Overtime Request ('APPROVED_PAID', 'APPROVED_OFFSET', 'REJECTED')
   * `approvedHours` defaults to the requested hours and is what gets credited.
   */
  async handleOvertimeDecision({ requestId, status, approvedHours, hrNotes, hrId }) {
    const { data: request, error: reqErr } = await supabase
      .from('overtime_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (reqErr) throw new Error(reqErr.message);

    const isApproval = status === 'APPROVED_OFFSET' || status === 'APPROVED_PAID';
    const resolvedApprovedHours = isApproval
      ? parseFloat(approvedHours ?? request.hours)
      : null;

    if (isApproval && !(resolvedApprovedHours > 0)) {
      throw new Error('Approved hours must be greater than zero.');
    }

    // Update Request Status
    const { data: updatedReq, error: updateErr } = await supabase
      .from('overtime_requests')
      .update({
        status,
        approved_hours: resolvedApprovedHours,
        hr_notes: hrNotes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (updateErr) throw new Error(updateErr.message);

    // If APPROVED_OFFSET, credit the approved (not requested) hours to the balance
    if (status === 'APPROVED_OFFSET') {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('offset_hours_balance')
        .eq('id', request.employee_id)
        .single();

      if (!empErr && emp) {
        const newBalance = parseFloat(emp.offset_hours_balance || 0) + resolvedApprovedHours;
        await supabase
          .from('employees')
          .update({ offset_hours_balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', request.employee_id);
      }
    }

    // Send Notification to Employee
    const statusLabel = status === 'APPROVED_OFFSET' ? 'Approved as Offset' : status === 'APPROVED_PAID' ? 'Approved as Paid OT' : 'Rejected';
    notificationService.createNotification({
      recipient_id: request.employee_id,
      sender_id: hrId,
      type: 'OVERTIME_DECISION',
      title: 'Overtime Request Status Updated',
      message: `Your overtime request for ${request.hours} hrs on ${request.date} has been ${statusLabel}.`,
      reference_id: requestId,
    });

    systemAuditLogService.addApprovalEvent(
      'OVERTIME',
      requestId,
      `Overtime request for ${request.hours} hrs on ${request.date} was ${statusLabel.toLowerCase()}.`,
      { event: 'OVERTIME_DECISION', status, employeeId: request.employee_id },
      hrId,
    ).catch(console.error);

    return updatedReq;
  },

  /**
   * Undo HR Overtime Decision
   * - Reverts the status to PENDING
   * - Refunds (deducts) the hours if they were APPROVED_OFFSET
   */
  async undoOvertimeDecision({ requestId, hrId }) {
    const { data: request, error: reqErr } = await supabase
      .from('overtime_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (reqErr) throw new Error(reqErr.message);
    if (request.status === 'PENDING') throw new Error('Request is already pending.');

    // If it was APPROVED_OFFSET, deduct what was actually credited.
    if (request.status === 'APPROVED_OFFSET') {
      const creditedHours = parseFloat(request.approved_hours ?? request.hours ?? 0);
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('offset_hours_balance')
        .eq('id', request.employee_id)
        .single();

      if (!empErr && emp) {
        const newBalance = parseFloat(emp.offset_hours_balance || 0) - creditedHours;
        await supabase
          .from('employees')
          .update({ offset_hours_balance: Math.max(0, newBalance), updated_at: new Date().toISOString() })
          .eq('id', request.employee_id);
      }
    }

    // Revert status
    const { data: updatedReq, error: updateErr } = await supabase
      .from('overtime_requests')
      .update({
        status: 'PENDING',
        approved_hours: null,
        hr_notes: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (updateErr) throw new Error(updateErr.message);

    // Notify employee
    notificationService.createNotification({
      recipient_id: request.employee_id,
      sender_id: hrId,
      type: 'OVERTIME_DECISION',
      title: 'Overtime Request Reverted',
      message: `HR has reverted the decision on your overtime request for ${request.date}. It is now PENDING again.`,
      reference_id: requestId,
    });

    systemAuditLogService.addSystemEvent(
      'OVERTIME',
      requestId,
      `Overtime decision for ${request.date} was reverted to PENDING (was ${request.status}).`,
      { event: 'OVERTIME_DECISION_UNDONE', previousStatus: request.status, employeeId: request.employee_id },
      hrId,
    ).catch(console.error);

    return updatedReq;
  },

  /**
   * HR Decision on an Offset Leave group ('APPROVED', 'REJECTED').
   *
   * Acts on every day-row sharing `groupId` — a single-day application is a
   * group of one, so this is the only decision path callers need. The balance
   * is checked against the group's total hours before anything is written, and
   * the day-rows are updated in one statement, so a range can never end up
   * half-approved: either the whole group's precondition holds and every row
   * moves together, or nothing does.
   */
  async handleOffsetLeaveDecision({ groupId, status, hrNotes, hrId }) {
    const { data: rows, error: rowsErr } = await supabase
      .from('offset_leaves')
      .select('*')
      .eq('leave_group_id', groupId);

    if (rowsErr) throw new Error(rowsErr.message);
    if (!rows || rows.length === 0) throw new Error('Leave application not found.');

    const employeeId = rows[0].employee_id;
    const totalHours = rows.reduce((sum, row) => sum + parseFloat(row.hours || 0), 0);

    if (status === 'APPROVED') {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('offset_hours_balance')
        .eq('id', employeeId)
        .single();

      if (empErr) throw new Error(empErr.message);
      const currentBal = parseFloat(emp.offset_hours_balance || 0);

      if (currentBal < totalHours) {
        throw new Error(`Cannot approve leave. Employee currently only has ${currentBal} hrs balance.`);
      }

      await supabase
        .from('employees')
        .update({
          offset_hours_balance: currentBal - totalHours,
          updated_at: new Date().toISOString(),
        })
        .eq('id', employeeId);
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from('offset_leaves')
      .update({
        status,
        hr_notes: hrNotes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('leave_group_id', groupId)
      .select();

    if (updateErr) throw new Error(updateErr.message);

    const dates = rows.map((row) => row.date).sort();
    const rangeLabel = dates.length > 1
      ? `${dates[0]} to ${dates[dates.length - 1]} (${dates.length} days)`
      : dates[0];

    notificationService.createNotification({
      recipient_id: employeeId,
      sender_id: hrId,
      type: 'OFFSET_LEAVE_DECISION',
      title: 'Offset Leave Application Status',
      message: `Your offset leave application for ${totalHours} hrs (${rangeLabel}) was ${status.toLowerCase()}.`,
      reference_id: groupId,
    });

    systemAuditLogService.addApprovalEvent(
      'OFFSET_LEAVE',
      groupId,
      `Offset leave application for ${totalHours} hrs (${rangeLabel}) was ${status.toLowerCase()}.`,
      { event: 'OFFSET_LEAVE_DECISION', status, employeeId, leaveGroupId: groupId },
      hrId,
    ).catch(console.error);

    return updatedRows;
  },

  /**
   * Undo HR's decision on an Offset Leave group.
   * - Reverts every day-row in the group to PENDING
   * - Refunds (adds) the group's total hours if it was APPROVED
   */
  async undoOffsetLeaveDecision({ groupId, hrId }) {
    const { data: rows, error: rowsErr } = await supabase
      .from('offset_leaves')
      .select('*')
      .eq('leave_group_id', groupId);

    if (rowsErr) throw new Error(rowsErr.message);
    if (!rows || rows.length === 0) throw new Error('Leave application not found.');

    const status = rows[0].status;
    if (status === 'PENDING') throw new Error('Leave is already pending.');

    const employeeId = rows[0].employee_id;
    const totalHours = rows.reduce((sum, row) => sum + parseFloat(row.hours || 0), 0);

    if (status === 'APPROVED') {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('offset_hours_balance')
        .eq('id', employeeId)
        .single();

      if (!empErr && emp) {
        const newBalance = parseFloat(emp.offset_hours_balance || 0) + totalHours;
        await supabase
          .from('employees')
          .update({ offset_hours_balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', employeeId);
      }
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from('offset_leaves')
      .update({
        status: 'PENDING',
        hr_notes: null,
        updated_at: new Date().toISOString(),
      })
      .eq('leave_group_id', groupId)
      .select();

    if (updateErr) throw new Error(updateErr.message);

    const dates = rows.map((row) => row.date).sort();
    const dateLabel = dates.length > 1 ? `${dates[0]} to ${dates[dates.length - 1]}` : dates[0];

    notificationService.createNotification({
      recipient_id: employeeId,
      sender_id: hrId,
      type: 'OFFSET_LEAVE_DECISION',
      title: 'Offset Leave Reverted',
      message: `HR has reverted the decision on your offset leave application for ${dateLabel}. It is now PENDING again.`,
      reference_id: groupId,
    });

    systemAuditLogService.addSystemEvent(
      'OFFSET_LEAVE',
      groupId,
      `Offset leave decision for ${dateLabel} was reverted to PENDING (was ${status}).`,
      { event: 'OFFSET_LEAVE_DECISION_UNDONE', previousStatus: status, employeeId, leaveGroupId: groupId },
      hrId,
    ).catch(console.error);

    return updatedRows;
  },

  /**
   * Withdraw Overtime Request (Employee)
   */
  async withdrawOvertimeRequest({ requestId, employeeId }) {
    const { data: request, error: reqErr } = await supabase
      .from('overtime_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (reqErr) throw new Error(reqErr.message);
    if (request.employee_id !== employeeId) throw new Error('Unauthorized');
    if (request.status !== 'PENDING') throw new Error('Only pending requests can be withdrawn.');

    const { data, error } = await supabase
      .from('overtime_requests')
      .update({
        status: 'CANCELLED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    systemAuditLogService.addSystemEvent(
      'OVERTIME',
      requestId,
      `Overtime request for ${request.date} was withdrawn by the employee.`,
      { event: 'OVERTIME_WITHDRAWN', employeeId },
      employeeId,
    ).catch(console.error);

    return data;
  },

  /**
   * Withdraw Offset Leave (Employee)
   */
  async withdrawOffsetLeave({ leaveId, employeeId }) {
    const { data: leave, error: leaveErr } = await supabase
      .from('offset_leaves')
      .select('*')
      .eq('id', leaveId)
      .single();

    if (leaveErr) throw new Error(leaveErr.message);
    if (leave.employee_id !== employeeId) throw new Error('Unauthorized');
    if (leave.status === 'REJECTED' || leave.status === 'CANCELLED') {
      throw new Error('Cannot withdraw this request.');
    }

    // If it was APPROVED, we must refund the hours back to the employee automatically
    if (leave.status === 'APPROVED') {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('offset_hours_balance')
        .eq('id', employeeId)
        .single();

      if (!empErr && emp) {
        const newBalance = parseFloat(emp.offset_hours_balance || 0) + parseFloat(leave.hours || 0);
        await supabase
          .from('employees')
          .update({ offset_hours_balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', employeeId);
      }

      // Notify HR that employee withdrew an approved leave
      notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
        sender_id: employeeId,
        type: 'OFFSET_LEAVE_DECISION',
        title: 'Approved Leave Withdrawn',
        message: `An employee withdrew their approved offset leave on ${leave.date}.`,
        reference_id: leaveId,
      });
    }

    const { data, error } = await supabase
      .from('offset_leaves')
      .update({
        status: 'CANCELLED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', leaveId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    systemAuditLogService.addSystemEvent(
      'OFFSET_LEAVE',
      leaveId,
      `Offset leave for ${leave.date} was withdrawn by the employee.`,
      { event: 'OFFSET_LEAVE_WITHDRAWN', employeeId },
      employeeId,
    ).catch(console.error);

    return data;
  }
};
