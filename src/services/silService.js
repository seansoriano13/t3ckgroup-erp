import { supabase } from '../lib/supabase';
import { notificationService } from './notificationService';

export const silService = {
  /**
   * Apply for SIL Leave (Employee)
   */
  async applySilLeave({ employeeId, date, hours, reason, employeeName }) {
    const parsedHours = parseFloat(hours);
    if (isNaN(parsedHours) || parsedHours <= 0) {
      throw new Error('Please enter a valid positive number of hours.');
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a reason for the SIL leave.');
    }

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

    const { data, error } = await supabase
      .from('sil_leaves')
      .insert([
        {
          employee_id: employeeId,
          date,
          hours: parsedHours,
          reason,
          status: 'PENDING',
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
      message: `${employeeName || 'An employee'} applied for ${parsedHours} hrs SIL leave on ${date}.`,
      reference_id: data.id,
    });

    return data;
  },

  /**
   * Get employee's own SIL leave applications
   */
  async getMySilLeaves(employeeId, startDate = null, endDate = null) {
    let query = supabase
      .from('sil_leaves')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lte('date', endDate);

    const { data, error } = await query;
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
        employee:employees!sil_leaves_employee_id_fkey(id, name, department, avatar_path, sil_hours_balance)
      `)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lte('date', endDate);

    const { data, error } = await query;
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
   * HR Decision on SIL Leave Request ('APPROVED', 'REJECTED')
   */
  async handleSilLeaveDecision({ leaveId, status, hrNotes, hrId }) {
    const { data: leave, error: leaveErr } = await supabase
      .from('sil_leaves')
      .select('*')
      .eq('id', leaveId)
      .single();

    if (leaveErr) throw new Error(leaveErr.message);

    // If approving, deduct balance first (or re-verify balance)
    if (status === 'APPROVED') {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('sil_hours_balance')
        .eq('id', leave.employee_id)
        .single();

      if (empErr) throw new Error(empErr.message);
      const currentBal = parseFloat(emp.sil_hours_balance || 0);
      const leaveHrs = parseFloat(leave.hours || 0);

      if (currentBal < leaveHrs) {
        throw new Error(`Cannot approve leave. Employee currently only has ${currentBal} hrs balance.`);
      }

      // Deduct balance
      await supabase
        .from('employees')
        .update({
          sil_hours_balance: currentBal - leaveHrs,
          updated_at: new Date().toISOString(),
        })
        .eq('id', leave.employee_id);
    }

    // Update Leave Status
    const { data: updatedLeave, error: updateErr } = await supabase
      .from('sil_leaves')
      .update({
        status,
        hr_notes: hrNotes || null,
        hr_processed_by: hrId || null,
        hr_processed_at: new Date().toISOString(),
      })
      .eq('id', leaveId)
      .select()
      .single();

    if (updateErr) throw new Error(updateErr.message);

    // Send Notification to Employee
    notificationService.createNotification({
      recipient_id: leave.employee_id,
      sender_id: hrId,
      type: 'SIL_LEAVE_DECISION',
      title: 'SIL Leave Application Status',
      message: `Your SIL leave application for ${leave.hours} hrs on ${leave.date} was ${status.toLowerCase()}.`,
      reference_id: leaveId,
    });

    return updatedLeave;
  },

  /**
   * Undo HR SIL Leave Decision
   * - Reverts the status to PENDING
   * - Refunds (adds) the hours if they were APPROVED
   */
  async undoSilLeaveDecision({ leaveId, hrId }) {
    const { data: leave, error: leaveErr } = await supabase
      .from('sil_leaves')
      .select('*')
      .eq('id', leaveId)
      .single();

    if (leaveErr) throw new Error(leaveErr.message);
    if (leave.status === 'PENDING') throw new Error('Leave is already pending.');

    // If it was APPROVED, refund the balance
    if (leave.status === 'APPROVED') {
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('sil_hours_balance')
        .eq('id', leave.employee_id)
        .single();

      if (!empErr && emp) {
        const newBalance = parseFloat(emp.sil_hours_balance || 0) + parseFloat(leave.hours || 0);
        await supabase
          .from('employees')
          .update({ sil_hours_balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', leave.employee_id);
      }
    }

    // Revert status
    const { data: updatedLeave, error: updateErr } = await supabase
      .from('sil_leaves')
      .update({
        status: 'PENDING',
        hr_notes: null,
        hr_processed_by: null,
        hr_processed_at: null,
      })
      .eq('id', leaveId)
      .select()
      .single();

    if (updateErr) throw new Error(updateErr.message);

    // Notify employee
    notificationService.createNotification({
      recipient_id: leave.employee_id,
      sender_id: hrId,
      type: 'SIL_LEAVE_DECISION',
      title: 'SIL Leave Request Reverted',
      message: `HR has reverted the decision on your SIL leave request for ${leave.date}. It is now PENDING again.`,
      reference_id: leaveId,
    });

    return updatedLeave;
  },

  /**
   * Cancel own SIL Leave application (Employee)
   */
  async cancelMySilLeave({ leaveId, employeeId }) {
    const { data: leave, error: leaveErr } = await supabase
      .from('sil_leaves')
      .select('*')
      .eq('id', leaveId)
      .single();

    if (leaveErr) throw new Error(leaveErr.message);
    if (leave.employee_id !== employeeId) throw new Error('Unauthorized');
    
    // Only pending or approved leaves in the future can be cancelled by employee
    // To be safe, let's refund if it was approved
    if (leave.status === 'APPROVED') {
       const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select('sil_hours_balance')
        .eq('id', leave.employee_id)
        .single();

      if (!empErr && emp) {
        const newBalance = parseFloat(emp.sil_hours_balance || 0) + parseFloat(leave.hours || 0);
        await supabase
          .from('employees')
          .update({ sil_hours_balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', leave.employee_id);
      }
    }

    const { data: updatedLeave, error: updateErr } = await supabase
      .from('sil_leaves')
      .update({
        status: 'CANCELLED',
      })
      .eq('id', leaveId)
      .select()
      .single();

    if (updateErr) throw new Error(updateErr.message);

    // Notify HR
    notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
      sender_id: employeeId,
      type: 'SIL_LEAVE_CANCELLED',
      title: 'SIL Leave Cancelled',
      message: `An employee cancelled their SIL leave for ${leave.hours} hrs on ${leave.date}.`,
      reference_id: leaveId,
    });

    return updatedLeave;
  },
};
