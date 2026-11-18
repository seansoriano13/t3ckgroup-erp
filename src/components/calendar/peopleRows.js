import { addDays } from 'date-fns';
import { manilaDate, parseManilaDate } from '@/lib/manilaDate.js';
import { TIME_OFF_KINDS, isOut } from './entrySpan.js';

const dayBefore = (ymd) => manilaDate(addDays(parseManilaDate(ymd), -1));
const dayAfter = (ymd) => manilaDate(addDays(parseManilaDate(ymd), 1));

/**
 * Pure helpers for the Calendar's bars: each multi-day group becomes bars
 * across the days it covers (the month grid and the Gantt), and the Gantt's
 * people rows are grouped by department.
 */

/**
 * Turns one person's entries into bars. Entries sharing a kind and group_id are one
 * request; its dates split into runs of consecutive days, one bar per run.
 * Each bar: { key, entry, days, kind, startYmd, endYmd, pending, lane, continuesBefore, continuesAfter }.
 * `entry` is the first day and `days` every day entry of the bar; the two flags say the request
 * goes on past the first or last shown day (so the bar draws an open edge there).
 */
export function entriesToBars(entries, days) {
  const index = new Map(days.map((ymd, i) => [ymd, i]));
  const groups = new Map();
  const dates = new Map();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.group_id ?? entry.id}`;
    dates.set(key, (dates.get(key) ?? new Set()).add(entry.manila_date));
    if (!index.has(entry.manila_date)) continue;
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
        days: run,
        pending: run.some((e) => e.status === 'PENDING'),
        continuesBefore: first.manila_date === days[0] && dates.get(key).has(dayBefore(days[0])),
        continuesAfter: run[run.length - 1].manila_date === days[days.length - 1] && dates.get(key).has(dayAfter(days[days.length - 1])),
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
 * The day entry a click on a bar means: the day under the pointer, or the bar's first day when
 * the pointer is not over it (keyboard, or a screen with no layout). `cols` are the day columns
 * the bar covers, from `startIndex`, and `fraction` is how far across the bar the click landed.
 */
export function dayAtFraction(bar, columns, startIndex, ymds, fraction) {
  if (!Number.isFinite(fraction)) return bar.entry;
  const at = Math.min(columns - 1, Math.max(0, Math.floor(fraction * columns)));
  const ymd = ymds[startIndex + at];
  return bar.days.find((e) => e.manila_date === ymd) ?? bar.entry;
}

/** The entry a click on a bar opens: the day under the pointer. */
export function entryUnderClick(bar, ymds, event) {
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  const fraction = rect?.width ? (event.clientX - rect.left) / rect.width : NaN;
  const start = ymds.indexOf(bar.startYmd);
  return dayAtFraction(bar, ymds.indexOf(bar.endYmd) - start + 1, start, ymds, fraction);
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
 * The people an entry is drawn for on the Gantt. An Activity (kind MEETING) is on the row of
 * its Lead and of every Participant; every other kind is on its one employee's row.
 * A person with no known department is looked up in `known` (id to employee).
 */
function peopleOf(entry, known) {
  if (entry.kind !== 'MEETING') return entry.employee?.id ? [entry.employee] : [];
  const d = entry.details ?? {};
  const lead = d.facilitator?.id ? [d.facilitator] : entry.employee?.id ? [entry.employee] : [];
  const seen = new Set();
  return [...lead, ...(d.participants ?? [])]
    .filter((p) => p?.id && !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ ...p, department: p.department ?? known.get(p.id)?.department }));
}

/**
 * The Gantt's people: one row per person with an entry, Activities included
 * (on the Lead's and each Participant's row), grouped by department (sorted,
 * "No department" for none), people sorted by name. `days` are the Manila dates the chart shows. `query` narrows by name
 * or department (case-insensitive). Returns [[department, rows]].
 */
export function groupByDepartment(entries, days, query = '') {
  const known = new Map();
  for (const entry of entries ?? []) if (entry.employee?.id && !known.has(entry.employee.id)) known.set(entry.employee.id, entry.employee);
  const people = new Map();
  for (const entry of entries ?? []) {
    for (const person of peopleOf(entry, known)) {
      const row = people.get(person.id) ?? { employee: person, entries: [] };
      row.entries.push(entry);
      people.set(person.id, row);
    }
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
