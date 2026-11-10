import { supabase } from '../lib/supabase';
import { DEFAULT_MEAL_WINDOWS, mealBreakHours, setMealWindows } from '../utils/mealBreak';
import { systemAuditLogService } from './systemAuditLogService';

const hhmm = (t) => String(t).slice(0, 5);

const REQUEST_TABLES = {
  OFFSET: { table: 'offset_leaves', by: 'leave_group_id' },
  SIL: { table: 'sil_leaves', by: 'leave_group_id' },
  LWOP: { table: 'lwop_leaves', by: 'leave_group_id' },
  OVERTIME: { table: 'overtime_requests', by: 'id' },
  UNDERTIME: { table: 'undertime_requests', by: 'id' },
};

export const mealBreakService = {
  /** HR's meal windows (all three, on or off); defaults if none are saved. */
  async getWindows() {
    const { data, error } = await supabase.from('meal_break_settings').select('*');
    if (error) throw new Error(error.message);
    if (!data?.length) return DEFAULT_MEAL_WINDOWS;
    return DEFAULT_MEAL_WINDOWS.map((def) => {
      const row = data.find((r) => r.key === def.key);
      return row ? { key: def.key, start: hhmm(row.start_time), end: hhmm(row.end_time), enabled: !!row.enabled } : def;
    });
  },

  /** Loads HR's windows into the shared rule. Never throws: defaults stand on failure. */
  async refresh() {
    try {
      setMealWindows(await mealBreakService.getWindows());
    } catch {
      setMealWindows(null);
    }
  },

  async saveWindow({ key, start, end, enabled }, actorId) {
    if (!(start < end)) throw new Error('The meal hour must end after it starts.');
    const { error } = await supabase
      .from('meal_break_settings')
      .upsert({ key, start_time: start, end_time: end, enabled });
    if (error) throw new Error(error.message);
    await mealBreakService.refresh();
    systemAuditLogService
      .addSystemEvent('HR_SETTINGS', key, `Meal Break "${key}" set to ${start}-${end}, ${enabled ? 'on' : 'off'}`, { event: 'MEAL_BREAK_UPDATED', key, start, end, enabled }, actorId)
      .catch(console.error);
  },

  /**
   * On review, HR keeps the meal hour in because no break was taken: the
   * request's stored hours go up by the hour its window covers, and the
   * reason is saved on it. Pending requests only, and only once.
   */
  async keepHourIn({ type, request, reason, hrId }) {
    if (!reason || !reason.trim()) throw new Error('Please give a reason for keeping the meal hour in.');
    const meta = REQUEST_TABLES[type];
    if (!meta) throw new Error('Unknown request type.');
    if (request.meal_break_kept_reason) throw new Error('The meal hour was already kept in.');
    const meals = await mealBreakService.getWindows();
    const addBack = mealBreakHours(request.start_time, request.end_time, meals);
    if (!(addBack > 0)) throw new Error('This request has no meal hour taken off.');
    const key = meta.by === 'id' ? request.id : request.leave_group_id;
    const { error } = await supabase
      .from(meta.table)
      .update({ hours: Number(request.hours) + addBack, meal_break_kept_reason: reason.trim() })
      .eq(meta.by, key)
      .eq('status', 'PENDING');
    if (error) throw new Error(error.message);
    systemAuditLogService
      .addApprovalEvent(type, key, `HR kept ${addBack} hr of meal break in: ${reason.trim()}`, { event: 'MEAL_BREAK_KEPT_IN', addBack }, hrId)
      .catch(console.error);
    return addBack;
  },
};
