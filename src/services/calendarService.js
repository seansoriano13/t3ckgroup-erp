import { supabase } from '../lib/supabase';

/**
 * The Calendar's one read (ADR 0037): every entry that overlaps the Manila date
 * range, in one shape, already filtered for this viewer by the database.
 *
 * `from` / `to` are Manila `YYYY-MM-DD` dates, inclusive. `includePending`
 * only matters to viewers who can open HR's Time Off & Overtime page; for
 * anyone else the server ignores it and sends approved entries alone.
 */
export const calendarService = {
  async fetchEntries({ from, to, includePending = false }) {
    const { data, error } = await supabase.rpc('calendar_entries', {
      p_from: from,
      p_to: to,
      p_include_pending: includePending,
    });
    if (error) throw error;
    return data ?? [];
  },
};
