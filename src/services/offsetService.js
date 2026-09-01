import { supabase } from '../lib/supabase';
import { notificationService } from './notificationService';
import { systemAuditLogService } from './systemAuditLogService';
import { deriveHours, windowsOverlap } from '../utils/time';

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
   */
  async handleOvertimeDecision({ requestId, status, hrNotes, hrId }) {
    const { data: request, error: reqErr } = await supabase
      .from('overtime_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (reqErr) throw new Error(reqErr.message);

    // Update Request Status
    const { data: updatedReq, error: updateErr } = await supabase
      .from('overtime_requests')
      .update({
        status,
        hr_notes: hrNotes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (updateErr) throw new Error(updateErr.message);

    // If APPROVED_OFFSET, credit hours to employee balance
    if (status === 'APPROVED_OFFSET') {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('offset_hours_balance')
        .eq('id', request.employee_id)
        .single();

      if (!empErr && emp) {
        const newBalance = parseFloat(emp.offset_hours_balance || 0) + parseFloat(request.hours || 0);
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

    // If it was APPROVED_OFFSET, we must deduct the balance
    if (request.status === 'APPROVED_OFFSET') {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('offset_hours_balance')
        .eq('id', request.employee_id)
        .single();

      if (!empErr && emp) {
        const newBalance = parseFloat(emp.offset_hours_balance || 0) - parseFloat(request.hours || 0);
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
   * HR Decision on Offset Leave Request ('APPROVED', 'REJECTED')
   */
  async handleOffsetLeaveDecision({ leaveId, status, hrNotes, hrId }) {
    const { data: leave, error: leaveErr } = await supabase
      .from('offset_leaves')
      .select('*')
      .eq('id', leaveId)
      .single();

    if (leaveErr) throw new Error(leaveErr.message);

    // If approving, deduct balance first (or re-verify balance)
    if (status === 'APPROVED') {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('offset_hours_balance')
        .eq('id', leave.employee_id)
        .single();

      if (empErr) throw new Error(empErr.message);
      const currentBal = parseFloat(emp.offset_hours_balance || 0);
      const leaveHrs = parseFloat(leave.hours || 0);

      if (currentBal < leaveHrs) {
        throw new Error(`Cannot approve leave. Employee currently only has ${currentBal} hrs balance.`);
      }

      // Deduct balance
      await supabase
        .from('employees')
        .update({
          offset_hours_balance: currentBal - leaveHrs,
          updated_at: new Date().toISOString(),
        })
        .eq('id', leave.employee_id);
    }

    // Update Leave Status
    const { data: updatedLeave, error: updateErr } = await supabase
      .from('offset_leaves')
      .update({
        status,
        hr_notes: hrNotes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leaveId)
      .select()
      .single();

    if (updateErr) throw new Error(updateErr.message);

    // Send Notification to Employee
    notificationService.createNotification({
      recipient_id: leave.employee_id,
      sender_id: hrId,
      type: 'OFFSET_LEAVE_DECISION',
      title: 'Offset Leave Application Status',
      message: `Your offset leave application for ${leave.hours} hrs on ${leave.date} was ${status.toLowerCase()}.`,
      reference_id: leaveId,
    });

    systemAuditLogService.addApprovalEvent(
      'OFFSET_LEAVE',
      leaveId,
      `Offset leave application for ${leave.hours} hrs on ${leave.date} was ${status.toLowerCase()}.`,
      { event: 'OFFSET_LEAVE_DECISION', status, employeeId: leave.employee_id },
      hrId,
    ).catch(console.error);

    return updatedLeave;
  },

  /**
   * Undo HR Offset Leave Decision
   * - Reverts the status to PENDING
   * - Refunds (adds) the hours if they were APPROVED
   */
  async undoOffsetLeaveDecision({ leaveId, hrId }) {
    const { data: leave, error: leaveErr } = await supabase
      .from('offset_leaves')
      .select('*')
      .eq('id', leaveId)
      .single();

    if (leaveErr) throw new Error(leaveErr.message);
    if (leave.status === 'PENDING') throw new Error('Leave is already pending.');

    // If it was APPROVED, refund the balance
    if (leave.status === 'APPROVED') {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('offset_hours_balance')
        .eq('id', leave.employee_id)
        .single();

      if (!empErr && emp) {
        const newBalance = parseFloat(emp.offset_hours_balance || 0) + parseFloat(leave.hours || 0);
        await supabase
          .from('employees')
          .update({ offset_hours_balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', leave.employee_id);
      }
    }

    // Revert status
    const { data: updatedLeave, error: updateErr } = await supabase
      .from('offset_leaves')
      .update({
        status: 'PENDING',
        hr_notes: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leaveId)
      .select()
      .single();

    if (updateErr) throw new Error(updateErr.message);

    // Notify employee
    notificationService.createNotification({
      recipient_id: leave.employee_id,
      sender_id: hrId,
      type: 'OFFSET_LEAVE_DECISION',
      title: 'Offset Leave Reverted',
      message: `HR has reverted the decision on your offset leave application for ${leave.date}. It is now PENDING again.`,
      reference_id: leaveId,
    });

    systemAuditLogService.addSystemEvent(
      'OFFSET_LEAVE',
      leaveId,
      `Offset leave decision for ${leave.date} was reverted to PENDING (was ${leave.status}).`,
      { event: 'OFFSET_LEAVE_DECISION_UNDONE', previousStatus: leave.status, employeeId: leave.employee_id },
      hrId,
    ).catch(console.error);

    return updatedLeave;
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
