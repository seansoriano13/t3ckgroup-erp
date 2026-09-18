import { supabase } from '../lib/supabase';
import { systemAuditLogService } from './systemAuditLogService';

/**
 * Reads and writes the day-shift configuration table (issue #150). Times
 * come back from Postgres as "HH:MM:SS"; trimmed to "HH:MM" here so callers
 * get the same shape the <input type="time"> fields already use.
 */
export const dayShiftService = {
  /**
   * All seven weekdays, ordered Sunday (0) through Saturday (6).
   */
  async getDayShiftConfig() {
    const { data, error } = await supabase
      .from('hr_day_shift_config')
      .select('*')
      .order('weekday', { ascending: true });

    if (error) throw new Error(error.message);

    return (data || []).map((row) => ({
      weekday: row.weekday,
      startTime: row.start_time ? row.start_time.slice(0, 5) : null,
      endTime: row.end_time ? row.end_time.slice(0, 5) : null,
      isWorkingDay: row.is_working_day,
    }));
  },

  /**
   * Updates one weekday's start time, end time and/or working-day flag.
   * Existing records are unaffected — they store the times actually filed.
   */
  async updateDayShiftDay(weekday, updates, actorId) {
    const patch = { updated_at: new Date().toISOString() };
    if (updates.startTime !== undefined) patch.start_time = updates.startTime;
    if (updates.endTime !== undefined) patch.end_time = updates.endTime;
    if (updates.isWorkingDay !== undefined) patch.is_working_day = updates.isWorkingDay;

    const { data, error } = await supabase
      .from('hr_day_shift_config')
      .update(patch)
      .eq('weekday', weekday)
      .select()
      .single();

    if (error) throw new Error(error.message);

    systemAuditLogService.addSystemEvent(
      'HR_SETTINGS',
      `day-shift-${weekday}`,
      `Updated day shift configuration for weekday ${weekday}`,
      { event: 'DAY_SHIFT_CONFIG_UPDATED', weekday, updates },
      actorId
    ).catch(console.error);

    return data;
  },
};
