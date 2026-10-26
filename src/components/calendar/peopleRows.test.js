import { describe, expect, it } from 'vitest';
import { entriesToBars, groupByDepartment, outByDay } from './peopleRows.js';

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

describe('groupByDepartment', () => {
  const ben = { id: 'p2', name: 'Ben Lim', department: 'IT' };
  const cara = { id: 'p3', name: 'Cara Tan', department: 'SALES' };
  const entries = [
    e('a', '2026-10-01'),
    e('b', '2026-10-02', { employee: ben }),
    e('c', '2026-10-09'),
    e('o', '2026-10-03', { kind: 'OVERTIME', hours: 3, employee: cara }),
    e('m', '2026-10-03', { kind: 'MEETING', employee: { id: 'p4', name: 'Dino Uy', department: 'HR' } }),
  ];

  it('groups people by department, ignoring meetings and days outside the view', () => {
    const groups = groupByDepartment(entries, days);
    expect(groups.map(([dept]) => dept)).toEqual(['IT', 'SALES']);
    const sales = groups[1][1];
    expect(sales.map((r) => r.employee.name)).toEqual(['Ana Cruz', 'Cara Tan']);
    expect(sales[0]).toMatchObject({ summary: '1 day out', lanes: 1 });
    expect(sales[1].summary).toBe('3 h overtime');
  });

  it('filters by name or department', () => {
    expect(groupByDepartment(entries, days, 'ben').flatMap(([, rows]) => rows.map((r) => r.employee.id))).toEqual(['p2']);
    expect(groupByDepartment(entries, days, 'sales').map(([dept]) => dept)).toEqual(['SALES']);
  });
});

describe('outByDay', () => {
  it('counts each person once a day, Time Off and undertime only', () => {
    const out = outByDay([
      e('a', '2026-10-01'),
      e('a2', '2026-10-01', { kind: 'UNDERTIME' }),
      e('b', '2026-10-01', { employee: { id: 'p2' } }),
      e('o', '2026-10-01', { kind: 'OVERTIME', employee: { id: 'p3' } }),
    ]);
    expect(out.get('2026-10-01')).toBe(2);
  });
});
