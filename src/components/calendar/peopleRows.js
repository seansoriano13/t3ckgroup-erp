import { TIME_OFF_KINDS, isOut } from './entrySpan.js';

/**
 * Pure helpers for the Calendar's bars: each multi-day group becomes bars
 * across the days it covers (the month grid and the Gantt), and the Gantt's
 * people rows are grouped by department.
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

/** How many people are out on each day: Time Off and undertime, one count per person per day. */
export function outByDay(entries) {
  const seen = new Map();
  for (const entry of entries ?? []) {
    if (!isOut(entry) || !entry.employee?.id) continue;
    const people = seen.get(entry.manila_date) ?? new Set();
    people.add(entry.employee.id);
    seen.set(entry.manila_date, people);
  }
  return new Map([...seen].map(([ymd, people]) => [ymd, people.size]));
}

/** "2 days out · 3 h overtime" for one person's row. */
function summarize(list) {
  const out = new Set(list.filter((e) => TIME_OFF_KINDS.has(e.kind)).map((e) => e.manila_date)).size;
  const overtime = list.filter((e) => e.kind === 'OVERTIME').reduce((h, e) => h + Number(e.hours ?? 0), 0);
  const under = list.some((e) => e.kind === 'UNDERTIME');
  return (
    [out && `${out} ${out === 1 ? 'day' : 'days'} out`, overtime && `${overtime} h overtime`, under && 'Undertime']
      .filter(Boolean)
      .join(' · ')
  );
}

/**
 * The Gantt's people: one row per person with an entry other than a meeting,
 * grouped by department (sorted, "No department" for none), people sorted by
 * name. `days` are the Manila dates the chart shows. `query` narrows by name
 * or department (case-insensitive). Returns [[department, rows]].
 */
export function groupByDepartment(entries, days, query = '') {
  const people = new Map();
  for (const entry of entries ?? []) {
    const person = entry.employee;
    if (entry.kind === 'MEETING' || !person?.id) continue;
    const row = people.get(person.id) ?? { employee: person, entries: [] };
    row.entries.push(entry);
    people.set(person.id, row);
  }
  const needle = query.trim().toLowerCase();
  const shown = new Set(days);
  const departments = new Map();
  for (const { employee, entries: list } of people.values()) {
    const dept = employee.department || 'No department';
    if (needle && !`${employee.name ?? ''} ${dept}`.toLowerCase().includes(needle)) continue;
    const bars = entriesToBars(list, days);
    if (bars.length === 0) continue;
    const rows = departments.get(dept) ?? [];
    const summary = summarize(list.filter((e) => shown.has(e.manila_date)));
    rows.push({ employee, bars, lanes: bars.reduce((n, b) => Math.max(n, b.lane + 1), 1), summary });
    departments.set(dept, rows);
  }
  return [...departments.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dept, rows]) => [dept, rows.sort((a, b) => (a.employee.name ?? '').localeCompare(b.employee.name ?? ''))]);
}
