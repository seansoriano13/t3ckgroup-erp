import { describe, expect, it } from 'vitest';
import { entriesToBars, groupByPerson } from './peopleRows.js';

const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
const e = (id, date, over = {}) => ({
  kind: 'SIL',
  id: `${id}-${date}`,
  group_id: id,
  manila_date: date,
  status: 'APPROVED',
  employee: { id: 'p1', name: 'Ana Cruz', department: 'SALES' },
  ...over,
});

describe('entriesToBars', () => {
  it('turns a multi-day group into one bar', () => {
    const bars = entriesToBars([e('g', '2026-10-01'), e('g', '2026-10-02'), e('g', '2026-10-03')], days);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ startYmd: '2026-10-01', endYmd: '2026-10-03', pending: false, lane: 0 });
  });

  it('splits a group at a gap and lanes overlapping bars', () => {
    const bars = entriesToBars([e('g', '2026-10-01'), e('g', '2026-10-04'), e('h', '2026-10-01', { kind: 'OFFSET' })], days);
    expect(bars).toHaveLength(3);
    expect(new Set(bars.filter((b) => b.startYmd === '2026-10-01').map((b) => b.lane)).size).toBe(2);
  });

  it('marks a bar pending when its entries are pending', () => {
    expect(entriesToBars([e('g', '2026-10-01', { status: 'PENDING' })], days)[0].pending).toBe(true);
  });
});

describe('groupByPerson', () => {
  const ben = { id: 'p2', name: 'Ben Lim', department: 'IT' };
  const entries = [e('a', '2026-10-01'), e('b', '2026-10-02', { employee: ben }), e('c', '2026-10-09')];

  it('makes one row per person, sorted by name, ignoring days outside the view', () => {
    const rows = groupByPerson(entries, days);
    expect(rows.map((r) => r.employee.name)).toEqual(['Ana Cruz', 'Ben Lim']);
    expect(rows[0].bars).toHaveLength(1);
  });

  it('filters by name or department', () => {
    expect(groupByPerson(entries, days, 'ben').map((r) => r.employee.id)).toEqual(['p2']);
    expect(groupByPerson(entries, days, 'sales').map((r) => r.employee.id)).toEqual(['p1']);
  });
});
