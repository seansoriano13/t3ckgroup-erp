import { supabase } from '../lib/supabase';
import { notificationService } from './notificationService';
import { systemAuditLogService } from './systemAuditLogService';
import { cleanAttachments, checkOverlap, checkDateTaken, stampApplication } from './offsetService';
import { manilaToday } from '../lib/manilaDate';
import { describeLeaveRange, formatWindow } from '../utils/time';
import { mealBreakService } from './mealBreakService';
import { assertNotWeekend, applyLunchDeduction, deriveLeaveHours } from './leaveRules';

/**
 * LWOP (Leave Without Pay, #616, spec #609): time an employee was away with no
 * pay and no balance spent. It is filed like SIL and goes employee ->
 * department head -> HR, but it is a record only. Nothing in this file reads
 * or writes a balance, checks eligibility, or counts pending hours.
 *
 * The decide / undo / withdraw functions live in Postgres
 * (`decide_lwop_leave_decision`, `undo_lwop_leave_decision`,
 * `cancel_lwop_leave`) and act on the whole `leave_group_id`, ADR 0013.
 */
export const lwopService = {
  /**
   * Stamp a printed batch's LWOP rows as printed (Document Center). Informational only; the
   * same group-or-id shape as silService.markSilLeavesPrinted.
   */
  async markLwopLeavesPrinted({ id, groupId, hrId }) {
    const query = supabase
      .from('lwop_leaves')
      .update({ printed_at: new Date().toISOString(), printed_by: hrId });

    const { error } = groupId ? await query.eq('leave_group_id', groupId) : await query.eq('id', id);
    if (error) throw new Error(error.message);
  },

  /**
   * Apply for LWOP on a single day with a time window (Employee).
   */
  async applyLwopLeave({ employeeId, date, startTime, endTime, reason, categoryId, employeeName, attachments = [], headId }) {
    await mealBreakService.refresh();
    const parsedHours = deriveLeaveHours(startTime, endTime);
    if (parsedHours <= 0) {
      throw new Error('Please enter a valid time window.');
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a reason for the LWOP.');
    }

    await checkOverlap(employeeId, date, startTime, endTime);

    assertNotWeekend(date);

    const { applicationHash, employeeSignatureVersion, employeeSignatureTimestamp, companyId } = await stampApplication({
      employeeId,
      categoryId,
      dates: [date],
      totalHours: parsedHours,
      reason,
    });

    const { data, error } = await supabase
      .from('lwop_leaves')
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

    notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
      sender_id: employeeId,
      type: 'LWOP_LEAVE_REQUEST',
      title: 'New LWOP Request',
      message: `${employeeName || 'An employee'} applied for ${parsedHours} hrs LWOP (${formatWindow(startTime, endTime)}) on ${date}.`,
      reference_id: data.id,
    });

    systemAuditLogService.addSystemEvent(
      'LWOP_LEAVE',
      data.id,
      `${employeeName || 'An employee'} applied for ${parsedHours} hrs LWOP (${formatWindow(startTime, endTime)}) on ${date}.`,
      { event: 'LWOP_LEAVE_APPLIED', employeeId },
      employeeId,
    ).catch(console.error);

    return data;
  },

  /**
   * Apply for LWOP across a date range (Employee). One row per day under a
   * shared `leave_group_id`, like `silService.applySilLeaveRange`. `days` is
   * `[{ date, hours }]`; the apply form defaults each day to 8 hours.
   */
  async applyLwopLeaveRange({ employeeId, days, reason, categoryId, employeeName, attachments = [], headId }) {
    if (!Array.isArray(days) || days.length === 0) {
      throw new Error('Please select at least one day.');
    }
    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a reason for the LWOP.');
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
      .from('lwop_leaves')
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
        head_id: headId || null,
        head_status: headId ? 'PENDING' : 'APPROVED',
        company_id: companyId,
      })))
      .select();

    if (error) throw new Error(error.message);

    const rangeLabel = normalizedDays.length > 1
      ? `${normalizedDays[0].date} to ${normalizedDays[normalizedDays.length - 1].date} (${normalizedDays.length} days)`
      : normalizedDays[0].date;

    notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
      sender_id: employeeId,
      type: 'LWOP_LEAVE_REQUEST',
      title: 'New LWOP Request',
      message: `${employeeName || 'An employee'} applied for ${totalHours} hrs LWOP (${rangeLabel}).`,
      reference_id: leaveGroupId,
    });

    systemAuditLogService.addSystemEvent(
      'LWOP_LEAVE',
      leaveGroupId,
      `${employeeName || 'An employee'} applied for ${totalHours} hrs LWOP (${rangeLabel}).`,
      { event: 'LWOP_LEAVE_APPLIED', employeeId, leaveGroupId },
      employeeId,
    ).catch(console.error);

    return data;
  },

  /** The employee's own LWOP applications. */
  async getMyLwopLeaves(employeeId, startDate = null, endDate = null) {
    let query = supabase
      .from('lwop_leaves')
      .select(`
        *,
        category:hr_leave_categories(label),
        head:employees!lwop_leaves_head_id_fkey(id, name)
      `)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lt('date', endDate);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },

  /** The employee's own pending LWOP applications (dateless). */
  async getMyPendingLwopLeaves(employeeId) {
    const { data, error } = await supabase
      .from('lwop_leaves')
      .select(`
        *,
        category:hr_leave_categories(label),
        head:employees!lwop_leaves_head_id_fkey(id, name)
      `)
      .eq('employee_id', employeeId)
      .eq('status', 'PENDING')
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /** Every LWOP application (HR). */
  async getAllLwopLeaves(startDate = null, endDate = null) {
    let query = supabase
      .from('lwop_leaves')
      .select(`
        *,
        employee:employees!lwop_leaves_employee_id_fkey(id, name, role, department, sub_department, employment_status, avatar_path, signature_path),
        hr:employees!lwop_leaves_hr_processed_by_fkey(id, name, signature_path),
        head:employees!lwop_leaves_head_id_fkey(id, name, signature_path),
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

  /** Every pending LWOP the head stage has cleared, across all time (HR). */
  async getAllPendingLwopLeaves() {
    const { data, error } = await supabase
      .from('lwop_leaves')
      .select(`
        *,
        employee:employees!lwop_leaves_employee_id_fkey(id, name, role, department, sub_department, employment_status, avatar_path),
        company:companies(id, name)
      `)
      .eq('status', 'PENDING')
      .or('head_status.eq.APPROVED,hr_override.eq.true')
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * HR decision on an LWOP group ('APPROVED', 'REJECTED'). Acts on every
   * day-row sharing `groupId`. The head-stage gate and the group lock live
   * inside `decide_lwop_leave_decision`; no balance moves.
   */
  async handleLwopLeaveDecision({ groupId, status, hrNotes, hrId }) {
    const { data: result, error } = await supabase.rpc('decide_lwop_leave_decision', {
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
      type: 'LWOP_LEAVE_DECISION',
      title: 'LWOP Application Status',
      message: `Your LWOP application for ${totalHours} hrs (${rangeLabel}) was ${status.toLowerCase()}.`,
      reference_id: groupId,
    });

    systemAuditLogService.addApprovalEvent(
      'LWOP_LEAVE',
      groupId,
      `LWOP application for ${totalHours} hrs (${rangeLabel}) was ${status.toLowerCase()}.`,
      { event: 'LWOP_LEAVE_DECISION', status, employeeId, leaveGroupId: groupId },
      hrId,
    ).catch(console.error);

    return updatedRows;
  },

  /**
   * HR records an absence as LWOP, already approved (#620). The group must
   * already exist as PENDING (filed on the employee's behalf); the database
   * function checks the caller is HR or a Super Admin and writes it APPROVED
   * with the head stage approved and `recorded_by_hr` set.
   */
  async recordLwopLeaveAsApproved({ groupId, hrId }) {
    const { data: result, error } = await supabase.rpc('record_lwop_leave_as_approved', {
      p_group_id: groupId,
      p_hr_id: hrId || null,
    });

    if (error) throw new Error(error.message);

    const { rows: updatedRows, employee_id: employeeId, total_hours: totalHours } = result;
    const rangeLabel = describeLeaveRange(result.dates, { withDayCount: true });

    notificationService.createNotification({
      recipient_id: employeeId,
      sender_id: hrId,
      type: 'LWOP_LEAVE_DECISION',
      title: 'LWOP Recorded',
      message: `HR recorded you as absent without pay for ${totalHours} hrs (${rangeLabel}).`,
      reference_id: groupId,
    });

    systemAuditLogService.addApprovalEvent(
      'LWOP_LEAVE',
      groupId,
      `LWOP for ${totalHours} hrs (${rangeLabel}) was recorded by HR as approved.`,
      { event: 'LWOP_LEAVE_RECORDED_BY_HR', status: 'APPROVED', employeeId, leaveGroupId: groupId },
      hrId,
    ).catch(console.error);

    return updatedRows;
  },

  /**
   * Approved LWOP hours per employee for the current Manila month. Derived and
   * read-only, like the undertime figure: never stored as a balance.
   */
  async getMonthlyLwopTotals() {
    const today = manilaToday();
    const monthStart = `${today.slice(0, 7)}-01`;
    const [y, m] = today.split('-').map(Number);
    const monthEnd = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const { data, error } = await supabase
      .from('lwop_leaves')
      .select('employee_id, hours')
      .eq('status', 'APPROVED')
      .gte('date', monthStart)
      .lt('date', monthEnd);

    if (error) throw new Error(error.message);

    const totals = {};
    for (const row of data || []) {
      totals[row.employee_id] = (totals[row.employee_id] || 0) + parseFloat(row.hours || 0);
    }
    return totals;
  },

  /** Undo HR's decision: every day-row returns to PENDING and the HR stamps clear. */
  async undoLwopLeaveDecision({ groupId, hrId }) {
    const { data: result, error } = await supabase.rpc('undo_lwop_leave_decision', {
      p_group_id: groupId,
      p_hr_id: hrId || null,
    });

    if (error) throw new Error(error.message);

    const { rows: updatedRows, employee_id: employeeId, previous_status: previousStatus } = result;
    const dateLabel = describeLeaveRange(result.dates);

    notificationService.createNotification({
      recipient_id: employeeId,
      sender_id: hrId,
      type: 'LWOP_LEAVE_DECISION',
      title: 'LWOP Request Reverted',
      message: `HR has reverted the decision on your LWOP request for ${dateLabel}. It is now PENDING again.`,
      reference_id: groupId,
    });

    systemAuditLogService.addSystemEvent(
      'LWOP_LEAVE',
      groupId,
      `LWOP decision for ${dateLabel} was reverted to PENDING (was ${previousStatus}).`,
      { event: 'LWOP_LEAVE_DECISION_UNDONE', previousStatus, employeeId, leaveGroupId: groupId },
      hrId,
    ).catch(console.error);

    return updatedRows;
  },

  /**
   * Withdraw own LWOP (Employee). The whole `leave_group_id` is withdrawn
   * together. A pending group can always be withdrawn; an approved one until
   * its first date has passed in Manila time (`cancel_lwop_leave`).
   */
  async cancelMyLwopLeave({ leaveId, employeeId }) {
    const { data: result, error } = await supabase.rpc('cancel_lwop_leave', {
      p_leave_id: leaveId,
      p_employee_id: employeeId,
    });

    if (error) throw new Error(error.message);

    const { rows: updatedRows, group_id: groupId, total_hours: totalHours } = result;
    const dateLabel = describeLeaveRange(result.dates);

    notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
      sender_id: employeeId,
      type: 'LWOP_LEAVE_CANCELLED',
      title: 'LWOP Withdrawn',
      message: `An employee withdrew their LWOP for ${totalHours} hrs (${dateLabel}).`,
      reference_id: groupId,
    });

    systemAuditLogService.addSystemEvent(
      'LWOP_LEAVE',
      groupId,
      `LWOP for ${dateLabel} was withdrawn by the employee.`,
      { event: 'LWOP_LEAVE_CANCELLED', employeeId, leaveGroupId: groupId },
      employeeId,
    ).catch(console.error);

    return updatedRows;
  },
};
