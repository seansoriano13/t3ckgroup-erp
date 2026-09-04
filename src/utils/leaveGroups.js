/**
 * Collapses leave/overtime day-rows sharing a `leave_group_id` into one
 * display entry per group, so a multi-day application reads in HR's Leaves
 * Manager as the single submission it was rather than N separate rows. Rows
 * with no `leave_group_id` (overtime, or any row predating this column) fall
 * back to grouping by their own `id` — a group of one, same as a single-day
 * leave.
 */
export function groupLeaveRows(rows) {
  const order = [];
  const byKey = new Map();

  for (const row of rows) {
    const key = row.leave_group_id || row.id;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key).push(row);
  }

  return order.map((key) => {
    const groupRows = [...byKey.get(key)].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const first = groupRows[0];
    const dates = groupRows.map((row) => row.date);
    const totalHours = groupRows.reduce((sum, row) => sum + parseFloat(row.hours || 0), 0);
    const updatedAt = groupRows.reduce(
      (latest, row) => (row.updated_at && (!latest || row.updated_at > latest) ? row.updated_at : latest),
      first.updated_at ?? null,
    );

    return {
      ...first,
      leave_group_id: key,
      dates,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      dayCount: dates.length,
      date: dates[0],
      hours: totalHours,
      updated_at: updatedAt,
    };
  });
}
