import { supabase } from '../lib/supabase';
import { notificationService } from './notificationService';
import { systemAuditLogService } from './systemAuditLogService';
import { deriveHours, describeLeaveRange, formatWindow, windowsOverlap } from '../utils/time';
import { generateApplicationHash } from '../utils/formHashes';
import { assertNotWeekend, applyLunchDeduction, deriveLeaveHours, deriveUndertimeHours, assertWithinAvailableBalance } from './leaveRules';
import { assertHeadCleared } from './headApprovalService';

/**
 * Keeps only usable Cloudinary descriptors, and stores null rather than an
 * empty array so "no attachments" reads the same on old and new rows.
 */
export function cleanAttachments(attachments) {
  const files = (attachments || []).filter((a) => a?.url);
  return files.length > 0 ? files : null;
}

async function fetchApplicationStamp(employeeId) {
  const { data } = await supabase.from('employees').select('signature_path, company_id').eq('id', employeeId).single();
  return { signaturePath: data?.signature_path || null, companyId: data?.company_id || null };
}

/**
 * Computes the application hash, the employee's signature stamp, and copies
 * their company (issue #142) — all shared by every apply path (overtime,
 * single-day and range offset/SIL). The company is read here, once, at
 * submission and never re-read afterward: it is stamped onto the record so a
 * later transfer never rewrites an already-filed form.
 */
export async function stampApplication({ employeeId, categoryId, dates, totalHours, reason }) {
  const { signaturePath, companyId } = await fetchApplicationStamp(employeeId);
  const applicationHash = await generateApplicationHash({ employeeId, categoryId, dates, totalHours, reason });
  const now = new Date().toISOString();

  return {
    applicationHash,
    employeeSignatureVersion: signaturePath,
    employeeSignatureTimestamp: signaturePath ? now : null,
    companyId,
  };
}

export async function checkOverlap(employeeId, date, startTime, endTime) {
  const [ot, offset, sil, undertime] = await Promise.all([
    supabase.from('overtime_requests').select('start_time, end_time').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
    supabase.from('offset_leaves').select('start_time, end_time').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
    supabase.from('sil_leaves').select('start_time, end_time').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
    // Undertime carries no single start/end pair — the window that actually
    // occupied the employee's day is the actual (worked) window, not the
    // original schedule, so that's what's compared here.
    supabase.from('undertime_requests').select('actual_start_time, actual_end_time').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
  ]);

  const allExisting = [
    ...(ot.data || []),
    ...(offset.data || []),
    ...(sil.data || []),
    ...(undertime.data || []).map((r) => ({ start_time: r.actual_start_time, end_time: r.actual_end_time })),
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
/**
 * Hours the employee has already committed to offset leaves still awaiting
 * an HR decision — the piece of "available" (issue #106) that the raw
 * `offset_hours_balance` column doesn't know about, since nothing is
 * deducted from it until approval.
 */
export async function getPendingOffsetHours(employeeId) {
  const { data, error } = await supabase
    .from('offset_leaves')
    .select('hours')
    .eq('employee_id', employeeId)
    .eq('status', 'PENDING');

  if (error) throw new Error(error.message);
  return (data || []).reduce((sum, row) => sum + parseFloat(row.hours || 0), 0);
}

export async function checkDateTaken(employeeId, date) {
  const [ot, offset, sil, undertime] = await Promise.all([
    supabase.from('overtime_requests').select('id').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
    supabase.from('offset_leaves').select('id').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
    supabase.from('sil_leaves').select('id').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
    supabase.from('undertime_requests').select('id').eq('employee_id', employeeId).eq('date', date).not('status', 'in', '("REJECTED","CANCELLED")'),
  ]);

  if ([...(ot.data || []), ...(offset.data || []), ...(sil.data || []), ...(undertime.data || [])].length > 0) {
    throw new Error(`An application already exists on ${date}.`);
  }
}

export const offsetService = {
  /**
   * Apply for Overtime (Employee)
   */
  async applyOvertime({ employeeId, date, startTime, endTime, reason, categoryId, employeeName, attachments = [], headId }) {
    const parsedHours = deriveHours(startTime, endTime, true);
    if (parsedHours <= 0) {
      throw new Error('Please enter a valid time window.');
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a reason for the overtime request.');
    }

    await checkOverlap(employeeId, date, startTime, endTime);

    const { applicationHash, employeeSignatureVersion, employeeSignatureTimestamp, companyId } = await stampApplication({
      employeeId,
      categoryId,
      dates: [date],
      totalHours: parsedHours,
      reason,
    });

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
   * Apply for Offset (Employee)
   */
  async applyOffsetLeave({ employeeId, date, startTime, endTime, reason, categoryId, employeeName, attachments = [], headId }) {
    const parsedHours = deriveLeaveHours(startTime, endTime);
    if (parsedHours <= 0) {
      throw new Error('Please enter a valid time window.');
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a reason for the Offset.');
    }

    await checkOverlap(employeeId, date, startTime, endTime);

    assertNotWeekend(date);

    // Check Employee Balance
    const { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('offset_hours_balance')
      .eq('id', employeeId)
      .single();

    if (empErr) throw new Error(empErr.message);

    const currentBalance = parseFloat(emp.offset_hours_balance || 0);
    const pendingHours = await getPendingOffsetHours(employeeId);
    assertWithinAvailableBalance({ currentBalance, pendingHours, requestedHours: parsedHours, leaveTypeLabel: 'offset' });

    const { applicationHash, employeeSignatureVersion, employeeSignatureTimestamp, companyId } = await stampApplication({
      employeeId,
      categoryId,
      dates: [date],
      totalHours: parsedHours,
      reason,
    });

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
      type: 'OFFSET_LEAVE_REQUEST',
      title: 'New Offset Request',
      message: `${employeeName || 'An employee'} applied for ${parsedHours} hrs Offset (${formatWindow(startTime, endTime)}) on ${date}.`,
      reference_id: data.id,
    });

    systemAuditLogService.addSystemEvent(
      'OFFSET_LEAVE',
      data.id,
      `${employeeName || 'An employee'} applied for ${parsedHours} hrs Offset (${formatWindow(startTime, endTime)}) on ${date}.`,
      { event: 'OFFSET_LEAVE_APPLIED', employeeId },
      employeeId,
    ).catch(console.error);

    return data;
  },

  /**
   * Apply for Offset across a date range (Employee).
   *
   * Writes one row per day under a shared `leave_group_id` rather than a
   * single row with an end date, so the calendar and month-boundary date
   * queries — which both assume one row is one day — keep working unchanged.
   * `days` is `[{ date, hours }]`; the caller (the apply form) is responsible
   * for defaulting each day to 8 hours and letting HR-visible edits narrow a
   * half-day inside the range.
   */
  async applyOffsetLeaveRange({ employeeId, days, reason, categoryId, employeeName, attachments = [], headId }) {
    if (!Array.isArray(days) || days.length === 0) {
      throw new Error('Please select at least one day.');
    }
    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a reason for the Offset.');
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

    const { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('offset_hours_balance')
      .eq('id', employeeId)
      .single();

    if (empErr) throw new Error(empErr.message);

    const currentBalance = parseFloat(emp.offset_hours_balance || 0);
    const pendingHours = await getPendingOffsetHours(employeeId);
    assertWithinAvailableBalance({ currentBalance, pendingHours, requestedHours: totalHours, leaveTypeLabel: 'offset' });

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
      .from('offset_leaves')
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
      type: 'OFFSET_LEAVE_REQUEST',
      title: 'New Offset Request',
      message: `${employeeName || 'An employee'} applied for ${totalHours} hrs Offset (${rangeLabel}).`,
      reference_id: leaveGroupId,
    });

    systemAuditLogService.addSystemEvent(
      'OFFSET_LEAVE',
      leaveGroupId,
      `${employeeName || 'An employee'} applied for ${totalHours} hrs Offset (${rangeLabel}).`,
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
      .select(`
        *,
        category:hr_leave_categories(label),
        head:employees!overtime_requests_head_id_fkey(id, name)
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
   * Get employee's own pending overtime requests (dateless)
   */
  async getMyPendingOvertimeRequests(employeeId) {
    const { data, error } = await supabase
      .from('overtime_requests')
      .select(`
        *,
        category:hr_leave_categories(label),
        head:employees!overtime_requests_head_id_fkey(id, name)
      `)
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
      .select(`
        *,
        category:hr_leave_categories(label),
        head:employees!offset_leaves_head_id_fkey(id, name)
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
   * Get employee's own pending offset leaves (dateless)
   */
  async getMyPendingOffsetLeaves(employeeId) {
    const { data, error } = await supabase
      .from('offset_leaves')
      .select(`
        *,
        category:hr_leave_categories(label),
        head:employees!offset_leaves_head_id_fkey(id, name)
      `)
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
        employee:employees!overtime_requests_employee_id_fkey(id, name, role, department, sub_department, employment_status, avatar_path, offset_hours_balance, signature_path),
        hr:employees!overtime_requests_hr_processed_by_fkey(id, name, signature_path),
        head:employees!overtime_requests_head_id_fkey(id, name, signature_path),
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
   * Fetch all pending overtime requests across all time (HR)
   */
  async getAllPendingOvertimeRequests() {
    const { data, error } = await supabase
      .from('overtime_requests')
      .select(`
        *,
        employee:employees!overtime_requests_employee_id_fkey(id, name, role, department, sub_department, employment_status, avatar_path, offset_hours_balance),
        category:hr_leave_categories(label),
        company:companies(id, name)
      `)
      .eq('status', 'PENDING')
      .or('head_status.eq.APPROVED,hr_override.eq.true')
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
        employee:employees!offset_leaves_employee_id_fkey(id, name, role, department, sub_department, employment_status, avatar_path, offset_hours_balance, signature_path),
        hr:employees!offset_leaves_hr_processed_by_fkey(id, name, signature_path),
        head:employees!offset_leaves_head_id_fkey(id, name, signature_path),
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
   * Fetch approved offset leaves for the shared calendar — employee view.
   *
   * Projects only the fields the calendar needs (person, date, type, time
   * window). Reason, hours balance, and signature path are omitted at the
   * query level so they never reach a non-HR browser. HR uses getAllOffsetLeaves
   * instead. See ADR 0012.
   */
  async getCalendarOffsetLeaves(startDate = null, endDate = null) {
    // RPC (security definer): table RLS is own-row/HR only, so a direct select
    // would hide colleagues' leaves. The function returns the projection only.
    const { data, error } = await supabase.rpc('get_calendar_offset_leaves', {
      p_start: startDate,
      p_end: endDate,
    });
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
        employee:employees!offset_leaves_employee_id_fkey(id, name, role, department, sub_department, employment_status, avatar_path, offset_hours_balance),
        category:hr_leave_categories(label),
        company:companies(id, name)
      `)
      .eq('status', 'PENDING')
      .or('head_status.eq.APPROVED,hr_override.eq.true')
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Hours already committed to the employee's own pending offset leaves —
   * exposed for the apply forms and pending queue to compute "available"
   * (issue #106) the same way the apply-time check does.
   */
  getPendingOffsetHours,

  /**
   * Fetch employee balances overview
   */
  async getEmployeeOffsetBalances() {
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, department, sub_department, offset_hours_balance, avatar_path, company:companies(id, name)')
      .neq('is_deleted', true)
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * HR Decision on Overtime Request ('APPROVED_PAID', 'APPROVED_OFFSET', 'REJECTED')
   * `approvedHours` defaults to the requested hours and is what gets credited.
   *
   * The row update, the balance credit, the approval hash/HR-signature
   * stamp, AND the department-head-cleared gate all happen inside one
   * Postgres function (`decide_overtime_request`, see the atomic-overtime
   * migration and ADR 0013, and the follow-up migration
   * 20260908130000_gate_overtime_decision_on_head_status.sql) so two
   * officers deciding two different requests for the same employee can
   * never race each other into losing a balance movement, and a decision
   * can never land between a client-side head-status read and the write —
   * there is no client-side pre-read to race against, unlike
   * handleOffsetLeaveDecision/handleSilLeaveDecision below, which are not
   * yet folded into a single RPC (see ADR 0013) and so still gate with a
   * pre-read `assertHeadCleared` call.
   */
  async handleOvertimeDecision({ requestId, status, approvedHours, hrNotes, hrId }) {
    const { data: updatedReq, error } = await supabase.rpc('decide_overtime_request', {
      p_request_id: requestId,
      p_status: status,
      p_approved_hours: approvedHours ?? null,
      p_hr_notes: hrNotes || null,
      p_hr_id: hrId || null,
    });

    if (error) throw new Error(error.message);

    // Send Notification to Employee
    const statusLabel = status === 'APPROVED_OFFSET' ? 'Approved as Offset' : status === 'APPROVED_PAID' ? 'Approved as Paid OT' : 'Rejected';
    notificationService.createNotification({
      recipient_id: updatedReq.employee_id,
      sender_id: hrId,
      type: 'OVERTIME_DECISION',
      title: 'Overtime Request Status Updated',
      message: `Your overtime request for ${updatedReq.hours} hrs on ${updatedReq.date} has been ${statusLabel}.`,
      reference_id: requestId,
    });

    systemAuditLogService.addApprovalEvent(
      'OVERTIME',
      requestId,
      `Overtime request for ${updatedReq.hours} hrs on ${updatedReq.date} was ${statusLabel.toLowerCase()}.`,
      { event: 'OVERTIME_DECISION', status, employeeId: updatedReq.employee_id },
      hrId,
    ).catch(console.error);

    return updatedReq;
  },

  /**
   * Undo HR Overtime Decision
   * - Reverts the status to PENDING
   * - Refunds (deducts) the hours if they were APPROVED_OFFSET, refusing
   *   outright rather than clamping at zero if the credited hours have
   *   already been spent elsewhere (issue #108) — clamping would silently
   *   invent hours the employee never gave back.
   * - Clears every trace of the decision being undone, `hr_processed_by`
   *   included, so a PENDING record never still names who decided it.
   *
   * See `undo_overtime_decision` (atomic-overtime migration, ADR 0013) for
   * where the balance check and the row revert now happen together.
   */
  async undoOvertimeDecision({ requestId, hrId }) {
    // Read-only, and only for the audit label below — the actual "already
    // pending" guard, the balance math, and every write happen inside the
    // RPC's lock, so a stale read here can at worst mislabel what the
    // decision used to be, never corrupt the outcome.
    const { data: before } = await supabase
      .from('overtime_requests')
      .select('status')
      .eq('id', requestId)
      .single();

    const { data: updatedReq, error } = await supabase.rpc('undo_overtime_decision', {
      p_request_id: requestId,
      p_hr_id: hrId || null,
    });

    if (error) throw new Error(error.message);

    notificationService.createNotification({
      recipient_id: updatedReq.employee_id,
      sender_id: hrId,
      type: 'OVERTIME_DECISION',
      title: 'Overtime Request Reverted',
      message: `HR has reverted the decision on your overtime request for ${updatedReq.date}. It is now PENDING again.`,
      reference_id: requestId,
    });

    systemAuditLogService.addSystemEvent(
      'OVERTIME',
      requestId,
      `Overtime decision for ${updatedReq.date} was reverted to PENDING (was ${before?.status ?? 'unknown'}).`,
      { event: 'OVERTIME_DECISION_UNDONE', previousStatus: before?.status ?? null, employeeId: updatedReq.employee_id },
      hrId,
    ).catch(console.error);

    return updatedReq;
  },

  /**
   * HR Decision on an Offset Leave group ('APPROVED', 'REJECTED').
   *
   * Acts on every day-row sharing `groupId` — a single-day application is a
   * group of one, so this is the only decision path callers need.
   *
   * The day-rows, the balance deduction, and the approval hash/HR-signature
   * stamp all happen inside one Postgres function
   * (`decide_offset_leave_decision`, see the atomic-offset-leave migration and
   * ADR 0013). The group moving as one unit is no longer a claim about the
   * order two writes are issued in — the function holds every day-row and the
   * employee row locked while it works, so the group can never be observed
   * half-decided and two officers deciding for one employee cannot race each
   * other into losing a balance movement.
   *
   * `approvedHours` (#328) is the group total HR approves — defaults to the
   * requested total, may not exceed it. The function spreads it across the
   * day-rows' `approved_hours` and spends exactly that.
   */
  async handleOffsetLeaveDecision({ groupId, status, approvedHours, hrNotes, hrId }) {
    // decide_offset_leave_decision enforces the head-status gate under its
    // own lock (#328); this pre-read just fails fast with the same message.
    if (status === 'APPROVED') {
      const { data: gateRow, error: gateErr } = await supabase
        .from('offset_leaves')
        .select('head_status, hr_override')
        .eq('leave_group_id', groupId)
        .limit(1)
        .maybeSingle();

      if (gateErr) throw new Error(gateErr.message);
      if (!gateRow) throw new Error('Leave application not found.');
      assertHeadCleared(gateRow, { action: 'approve this Offset' });
    }

    const { data: result, error } = await supabase.rpc('decide_offset_leave_decision', {
      p_group_id: groupId,
      p_status: status,
      p_hr_notes: hrNotes || null,
      p_hr_id: hrId || null,
      p_approved_hours: status === 'APPROVED' && approvedHours != null ? approvedHours : null,
    });

    if (error) throw new Error(error.message);

    const { rows: updatedRows, employee_id: employeeId, total_hours: requestedHours, approved_hours: approvedTotal } = result;
    const decidedHours = approvedTotal ?? requestedHours;
    const rangeLabel = describeLeaveRange(result.dates, { withDayCount: true });

    notificationService.createNotification({
      recipient_id: employeeId,
      sender_id: hrId,
      type: 'OFFSET_LEAVE_DECISION',
      title: 'Offset Application Status',
      message: `Your offset leave application for ${decidedHours} hrs (${rangeLabel}) was ${status.toLowerCase()}.`,
      reference_id: groupId,
    });

    systemAuditLogService.addApprovalEvent(
      'OFFSET_LEAVE',
      groupId,
      `Offset leave application for ${decidedHours} hrs (${rangeLabel}) was ${status.toLowerCase()}.`,
      { event: 'OFFSET_LEAVE_DECISION', status, employeeId, leaveGroupId: groupId },
      hrId,
    ).catch(console.error);

    return updatedRows;
  },

  /**
   * Undo HR's decision on an Offset Leave group.
   * - Reverts every day-row in the group to PENDING
   * - Refunds (adds) the group's total hours if it was APPROVED
   *
   * See `undo_offset_leave_decision` (atomic-offset-leave migration, ADR 0013)
   * for where the revert and the refund now happen together. Unlike overtime's
   * undo, the refund here is an addition, so there is no "already spent" case
   * to refuse.
   */
  async undoOffsetLeaveDecision({ groupId, hrId }) {
    const { data: result, error } = await supabase.rpc('undo_offset_leave_decision', {
      p_group_id: groupId,
      p_hr_id: hrId || null,
    });

    if (error) throw new Error(error.message);

    const { rows: updatedRows, employee_id: employeeId, previous_status: previousStatus } = result;
    const dateLabel = describeLeaveRange(result.dates);

    notificationService.createNotification({
      recipient_id: employeeId,
      sender_id: hrId,
      type: 'OFFSET_LEAVE_DECISION',
      title: 'Offset Reverted',
      message: `HR has reverted the decision on your Offset application for ${dateLabel}. It is now PENDING again.`,
      reference_id: groupId,
    });

    systemAuditLogService.addSystemEvent(
      'OFFSET_LEAVE',
      groupId,
      `Offset decision for ${dateLabel} was reverted to PENDING (was ${previousStatus}).`,
      { event: 'OFFSET_LEAVE_DECISION_UNDONE', previousStatus, employeeId, leaveGroupId: groupId },
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

    // The write repeats the PENDING check so an HR decision landing between
    // the read above and this update can never be overwritten: the update
    // then matches no rows instead of clobbering an approval (and its
    // balance credit) with a blind CANCELLED status.
    const { data, error } = await supabase
      .from('overtime_requests')
      .update({
        status: 'CANCELLED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('status', 'PENDING')
      .select();

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new Error('This request was just decided by HR and can no longer be withdrawn.');
    }

    systemAuditLogService.addSystemEvent(
      'OVERTIME',
      requestId,
      `Overtime request for ${request.date} was withdrawn by the employee.`,
      { event: 'OVERTIME_WITHDRAWN', employeeId },
      employeeId,
    ).catch(console.error);

    return data[0];
  },

  /**
   * Withdraw Offset Leave (Employee).
   *
   * Operates on the whole leave_group_id, not just the clicked row, mirroring
   * handleOffsetLeaveDecision's group-atomic pattern — a date-range leave is
   * withdrawn and refunded as one group, never partially.
   *
   * `withdraw_offset_leave` (atomic-offset-leave migration) reads the group's
   * status under the same lock it writes through, which is what stops an HR
   * approval landing mid-withdraw from leaving a CANCELLED leave with its
   * hours still deducted.
   */
  async withdrawOffsetLeave({ leaveId, employeeId }) {
    const { data: result, error } = await supabase.rpc('withdraw_offset_leave', {
      p_leave_id: leaveId,
      p_employee_id: employeeId,
    });

    if (error) throw new Error(error.message);

    const { rows: updatedRows, group_id: groupId, total_hours: totalHours, previous_status: previousStatus } = result;
    const dateLabel = describeLeaveRange(result.dates);

    // Notify HR that the employee withdrew a leave HR had already approved —
    // the balance has moved back, and HR may need to know why.
    if (previousStatus === 'APPROVED') {
      notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
        sender_id: employeeId,
        type: 'OFFSET_LEAVE_DECISION',
        title: 'Approved Leave Withdrawn',
        message: `An employee withdrew their approved Offset for ${totalHours} hrs (${dateLabel}).`,
        reference_id: groupId,
      });
    }

    systemAuditLogService.addSystemEvent(
      'OFFSET_LEAVE',
      groupId,
      `Offset for ${dateLabel} was withdrawn by the employee.`,
      { event: 'OFFSET_LEAVE_WITHDRAWN', employeeId, leaveGroupId: groupId },
      employeeId,
    ).catch(console.error);

    return updatedRows;
  },

  /**
   * Stamp a printed batch's offset leaves as printed (Document Center).
   * Informational only — never blocks a later reprint. Operates on the whole
   * leave_group_id when the record is part of a range, mirroring every other
   * group-atomic mutation in this file.
   */
  async markOffsetLeavesPrinted({ id, groupId, hrId }) {
    const query = supabase
      .from('offset_leaves')
      .update({ printed_at: new Date().toISOString(), printed_by: hrId });

    const { error } = groupId ? await query.eq('leave_group_id', groupId) : await query.eq('id', id);
    if (error) throw new Error(error.message);
  },

  /**
   * Stamp a printed batch's overtime requests as printed (Document Center).
   * Overtime requests are never grouped, so this is always a single-id
   * update, unlike the leave-side stamp above.
   */
  async markOvertimeRequestsPrinted({ id, hrId }) {
    const { error } = await supabase
      .from('overtime_requests')
      .update({ printed_at: new Date().toISOString(), printed_by: hrId })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  /**
   * Apply for Undertime (Employee) — issue #147. Modeled directly on
   * applyOvertime, with two differences: the hours figure is the shortfall
   * between the scheduled ("original") window and what was actually worked
   * ("actual"), via `deriveUndertimeHours`, and — like every leave
   * application — a weekend date is refused outright (overtime allows one;
   * you cannot fall short of a shift that was never scheduled).
   */
  async applyUndertime({
    employeeId,
    date,
    originalStartTime,
    originalEndTime,
    actualStartTime,
    actualEndTime,
    reason,
    categoryId,
    employeeName,
    attachments = [],
    headId,
  }) {
    assertNotWeekend(date);

    const parsedHours = deriveUndertimeHours(
      { startTime: originalStartTime, endTime: originalEndTime },
      { startTime: actualStartTime, endTime: actualEndTime },
    );
    if (!(parsedHours > 0)) {
      throw new Error('Please enter a valid time window — the actual window must be shorter than the original schedule.');
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Please provide a purpose for the undertime request.');
    }

    await checkOverlap(employeeId, date, actualStartTime, actualEndTime);

    const { applicationHash, employeeSignatureVersion, employeeSignatureTimestamp, companyId } = await stampApplication({
      employeeId,
      categoryId,
      dates: [date],
      totalHours: parsedHours,
      reason,
    });

    const { data, error } = await supabase
      .from('undertime_requests')
      .insert([
        {
          employee_id: employeeId,
          date,
          original_start_time: originalStartTime,
          original_end_time: originalEndTime,
          actual_start_time: actualStartTime,
          actual_end_time: actualEndTime,
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
      type: 'UNDERTIME_REQUEST',
      title: 'New Undertime Application',
      message: `${employeeName || 'An employee'} filed ${parsedHours} hrs of undertime on ${date}.`,
      reference_id: data.id,
    });

    systemAuditLogService.addSystemEvent(
      'UNDERTIME',
      data.id,
      `${employeeName || 'An employee'} filed ${parsedHours} hrs of undertime on ${date}.`,
      { event: 'UNDERTIME_APPLIED', employeeId },
      employeeId,
    ).catch(console.error);

    return data;
  },

  /**
   * Get employee's own undertime requests
   */
  async getMyUndertimeRequests(employeeId, startDate = null, endDate = null) {
    let query = supabase
      .from('undertime_requests')
      .select(`
        *,
        category:hr_leave_categories(label),
        head:employees!undertime_requests_head_id_fkey(id, name)
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
   * Get employee's own pending undertime requests (dateless)
   */
  async getMyPendingUndertimeRequests(employeeId) {
    const { data, error } = await supabase
      .from('undertime_requests')
      .select(`
        *,
        category:hr_leave_categories(label),
        head:employees!undertime_requests_head_id_fkey(id, name)
      `)
      .eq('employee_id', employeeId)
      .eq('status', 'PENDING')
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Fetch all undertime requests (HR)
   */
  async getAllUndertimeRequests(startDate = null, endDate = null) {
    let query = supabase
      .from('undertime_requests')
      .select(`
        *,
        employee:employees!undertime_requests_employee_id_fkey(id, name, role, department, sub_department, employment_status, avatar_path, signature_path),
        hr:employees!undertime_requests_hr_processed_by_fkey(id, name, signature_path),
        head:employees!undertime_requests_head_id_fkey(id, name, signature_path),
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
   * Fetch all pending undertime requests across all time (HR)
   */
  async getAllPendingUndertimeRequests() {
    const { data, error } = await supabase
      .from('undertime_requests')
      .select(`
        *,
        employee:employees!undertime_requests_employee_id_fkey(id, name, role, department, sub_department, employment_status, avatar_path),
        category:hr_leave_categories(label),
        company:companies(id, name)
      `)
      .eq('status', 'PENDING')
      .or('head_status.eq.APPROVED,hr_override.eq.true')
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * HR Decision on an Undertime Request ('APPROVED', 'REJECTED') — issue #148.
   *
   * Unlike handleOvertimeDecision, there is no balance to credit: undertime
   * never touches offset_hours_balance or sil_hours_balance on any status,
   * on any path. `decide_undertime_request` gates APPROVED-family decisions
   * on the department-head stage exactly like `decide_overtime_request`
   * does, but has no APPROVED_OFFSET branch to port — there simply isn't
   * one for this request type.
   */
  async handleUndertimeDecision({ requestId, status, approvedHours, hrNotes, hrId }) {
    const { data: updatedReq, error } = await supabase.rpc('decide_undertime_request', {
      p_request_id: requestId,
      p_status: status,
      p_approved_hours: approvedHours ?? null,
      p_hr_notes: hrNotes || null,
      p_hr_id: hrId || null,
    });

    if (error) throw new Error(error.message);

    const statusLabel = status === 'APPROVED' ? 'Approved' : 'Rejected';
    notificationService.createNotification({
      recipient_id: updatedReq.employee_id,
      sender_id: hrId,
      type: 'UNDERTIME_DECISION',
      title: 'Undertime Request Status Updated',
      message: `Your undertime request for ${updatedReq.hours} hrs on ${updatedReq.date} has been ${statusLabel}.`,
      reference_id: requestId,
    });

    systemAuditLogService.addApprovalEvent(
      'UNDERTIME',
      requestId,
      `Undertime request for ${updatedReq.hours} hrs on ${updatedReq.date} was ${statusLabel.toLowerCase()}.`,
      { event: 'UNDERTIME_DECISION', status, employeeId: updatedReq.employee_id },
      hrId,
    ).catch(console.error);

    return updatedReq;
  },

  /**
   * Undo HR Undertime Decision — reverts the status to PENDING and clears
   * every trace of the decision. No balance to refund/refuse: see
   * undo_undertime_decision (undertime never touches offset_hours_balance or
   * sil_hours_balance).
   */
  async undoUndertimeDecision({ requestId, hrId }) {
    const { data: before } = await supabase
      .from('undertime_requests')
      .select('status')
      .eq('id', requestId)
      .single();

    const { data: updatedReq, error } = await supabase.rpc('undo_undertime_decision', {
      p_request_id: requestId,
      p_hr_id: hrId || null,
    });

    if (error) throw new Error(error.message);

    notificationService.createNotification({
      recipient_id: updatedReq.employee_id,
      sender_id: hrId,
      type: 'UNDERTIME_DECISION',
      title: 'Undertime Request Reverted',
      message: `HR has reverted the decision on your undertime request for ${updatedReq.date}. It is now PENDING again.`,
      reference_id: requestId,
    });

    systemAuditLogService.addSystemEvent(
      'UNDERTIME',
      requestId,
      `Undertime decision for ${updatedReq.date} was reverted to PENDING (was ${before?.status ?? 'unknown'}).`,
      { event: 'UNDERTIME_DECISION_UNDONE', previousStatus: before?.status ?? null, employeeId: updatedReq.employee_id },
      hrId,
    ).catch(console.error);

    return updatedReq;
  },

  /**
   * Withdraw Undertime Request (Employee)
   */
  async withdrawUndertimeRequest({ requestId, employeeId }) {
    const { data: request, error: reqErr } = await supabase
      .from('undertime_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (reqErr) throw new Error(reqErr.message);
    if (request.employee_id !== employeeId) throw new Error('Unauthorized');
    if (request.status !== 'PENDING') throw new Error('Only pending requests can be withdrawn.');

    const { data, error } = await supabase
      .from('undertime_requests')
      .update({
        status: 'CANCELLED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('status', 'PENDING')
      .select();

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new Error('This request was just decided by HR and can no longer be withdrawn.');
    }

    systemAuditLogService.addSystemEvent(
      'UNDERTIME',
      requestId,
      `Undertime request for ${request.date} was withdrawn by the employee.`,
      { event: 'UNDERTIME_WITHDRAWN', employeeId },
      employeeId,
    ).catch(console.error);

    return data[0];
  },

  /**
   * Stamp a printed batch's undertime requests as printed (Document Center).
   */
  async markUndertimeRequestsPrinted({ id, hrId }) {
    const { error } = await supabase
      .from('undertime_requests')
      .update({ printed_at: new Date().toISOString(), printed_by: hrId })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  /**
   * Derived, read-only monthly undertime totals per employee (issue #148) —
   * summed from APPROVED requests only (pending/rejected/cancelled hours
   * were never actually taken), for the current calendar month. Computed on
   * read every time, never stored, so it can never drift from the
   * underlying rows the way a cached balance column could.
   */
  async getMonthlyUndertimeTotals() {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

    const { data, error } = await supabase
      .from('undertime_requests')
      .select('employee_id, hours, approved_hours')
      .eq('status', 'APPROVED')
      .gte('date', monthStart)
      .lt('date', monthEnd);

    if (error) throw new Error(error.message);

    const totals = {};
    for (const row of data || []) {
      const hours = row.approved_hours != null ? parseFloat(row.approved_hours) : parseFloat(row.hours || 0);
      totals[row.employee_id] = (totals[row.employee_id] || 0) + hours;
    }
    return totals;
  },
};
