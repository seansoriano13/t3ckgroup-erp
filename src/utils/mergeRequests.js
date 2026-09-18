import { groupLeaveRows } from './leaveGroups';

/**
 * Merges Offset, SIL, Overtime and Undertime rows into the single
 * newest-first collection "My Requests" shows, with type as a filter rather
 * than a tab (issue #158, #159).
 *
 * `rowsByType` may contain the same row twice — an employee's pending query
 * and their date-bounded history query both return rows currently awaiting
 * a decision — so rows are de-duplicated by (type, id) before grouping.
 * Grouping then reuses `groupLeaveRows`, so a multi-day SIL or Offset
 * application still appears once rather than once per day.
 */
export function mergeRequestRows(rowsByType) {
  const merged = [];

  // Grouped per type, not across the concatenated set: two different
  // request tables can otherwise share a row id, and groupLeaveRows keys
  // purely on id when there is no leave_group_id.
  for (const type of Object.keys(rowsByType)) {
    const seen = new Set();
    const deduped = [];
    for (const row of rowsByType[type] || []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      deduped.push(row);
    }
    merged.push(...groupLeaveRows(deduped).map((row) => ({ ...row, type })));
  }

  return merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}
