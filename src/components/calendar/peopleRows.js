/**
 * Pure helpers for the People view (#618): entries become one row per person,
 * and each multi-day group becomes bars across the days it covers.
 */

/**
 * Turns one person's entries into bars. Entries sharing a kind and group_id are one
 * request; its dates split into runs of consecutive days, one bar per run.
 * Each bar: { key, entry, kind, startYmd, endYmd, pending, lane }.
 */
export function entriesToBars(entries, days) {
  const index = new Map(days.map((ymd, i) => [ymd, i]));
  const groups = new Map();
  for (const entry of entries) {
    if (!index.has(entry.manila_date)) continue;
    const key = `${entry.kind}:${entry.group_id ?? entry.id}`;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  const bars = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => index.get(a.manila_date) - index.get(b.manila_date));
    let run = [sorted[0]];
    const flush = () => {
      const first = run[0];
      bars.push({
        key: `${key}:${first.manila_date}`,
        entry: first,
        kind: first.kind,
        startYmd: first.manila_date,
        endYmd: run[run.length - 1].manila_date,
        pending: run.some((e) => e.status === 'PENDING'),
      });
    };
    for (let i = 1; i < sorted.length; i++) {
      const gap = index.get(sorted[i].manila_date) - index.get(run[run.length - 1].manila_date);
      if (gap <= 1) run.push(sorted[i]);
      else {
        flush();
        run = [sorted[i]];
      }
    }
    flush();
  }

  // Overlapping bars go on separate lanes so none hides another.
  bars.sort((a, b) => index.get(a.startYmd) - index.get(b.startYmd));
  const laneEnds = [];
  for (const bar of bars) {
    const start = index.get(bar.startYmd);
    let lane = laneEnds.findIndex((end) => end < start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = index.get(bar.endYmd);
    bar.lane = lane;
  }
  return bars;
}

/**
 * One row per person, sorted by name. `days` are the Manila dates the view shows.
 * `query` narrows by name or department (case-insensitive).
 */
export function groupByPerson(entries, days, query = '') {
  const people = new Map();
  for (const entry of entries ?? []) {
    const person = entry.employee;
    if (!person?.id) continue;
    const row = people.get(person.id) ?? { employee: person, entries: [] };
    row.entries.push(entry);
    people.set(person.id, row);
  }
  const needle = query.trim().toLowerCase();
  return [...people.values()]
    .filter(
      ({ employee }) =>
        !needle ||
        (employee.name ?? '').toLowerCase().includes(needle) ||
        (employee.department ?? '').toLowerCase().includes(needle),
    )
    .sort((a, b) => (a.employee.name ?? '').localeCompare(b.employee.name ?? ''))
    .map(({ employee, entries: list }) => {
      const bars = entriesToBars(list, days);
      return { employee, bars, lanes: bars.reduce((n, b) => Math.max(n, b.lane + 1), 1) };
    })
    .filter((row) => row.bars.length > 0);
}
