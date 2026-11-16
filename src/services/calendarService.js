import { supabase } from '../lib/supabase';

/**
 * The Calendar's one read (ADR 0037): every entry that overlaps the Manila date
 * range, in one shape, already filtered for this viewer by the database.
 *
 * `from` / `to` are Manila `YYYY-MM-DD` dates, inclusive. `includePending`
 * only matters to viewers who can open HR's Time Off & Overtime page; for
 * anyone else the server ignores it and sends approved entries alone.
 */
// Where each entry kind keeps its date, so an address can find the entry's month.
const DATE_SOURCE = {
  MEETING: { table: 'meeting_requests', column: 'starts_at' },
  SIL: { table: 'sil_leaves', column: 'date' },
  LWOP: { table: 'lwop_leaves', column: 'date' },
  OFFSET: { table: 'offset_leaves', column: 'date' },
  OVERTIME: { table: 'overtime_requests', column: 'date' },
  UNDERTIME: { table: 'undertime_requests', column: 'date' },
};

export const calendarService = {
  /** The Manila date (YYYY-MM-DD) of one entry, or null when it is unknown or not readable by this viewer. */
  async fetchEntryDate({ kind, id }) {
    const source = DATE_SOURCE[kind];
    if (!source) return null;
    const { data, error } = await supabase.from(source.table).select(source.column).eq('id', id).maybeSingle();
    if (error) throw error;
    const raw = data?.[source.column];
    if (!raw) return null;
    if (source.column === 'date') return String(raw).slice(0, 10);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(raw));
  },

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
