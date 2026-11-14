import { supabase } from '../lib/supabase';
import { mergeRequestRows } from '../utils/mergeRequests';
import { isRecordId } from '../utils/recordLink';

/**
 * One of the signed-in employee's own requests, found from a notification's
 * `reference_id`. That id is a row id in some notifications and a leave group
 * id in others, and the request's type is not known, so every table is asked.
 * Returns rows shaped like My Requests' own list (`type` set, days grouped), or [].
 */
const TABLES = {
  SIL: { table: 'sil_leaves', grouped: true },
  LWOP: { table: 'lwop_leaves', grouped: true },
  OFFSET: { table: 'offset_leaves', grouped: true },
  OVERTIME: { table: 'overtime_requests', grouped: false },
  UNDERTIME: { table: 'undertime_requests', grouped: false },
};

export async function getMyRequestByRef(employeeId, ref) {
  // The ref goes into a filter string: anything that is not an id is not found, and no request is sent.
  if (!isRecordId(ref)) return [];
  const byType = {};
  await Promise.all(
    Object.entries(TABLES).map(async ([type, { table, grouped }]) => {
      let query = supabase.from(table).select('*, category:hr_leave_categories(label)').eq('employee_id', employeeId);
      query = grouped ? query.or(`id.eq.${ref},leave_group_id.eq.${ref}`) : query.eq('id', ref);
      const { data, error } = await query;
      if (error) return;
      byType[type] = data || [];
    }),
  );
  return mergeRequestRows(byType);
}
