import { describe, expect, it } from 'vitest';
import { assignLanes, placeDay } from './timeGrid.js';

const timedEntry = (id, startIso, endIso, extra = {}) => ({
  kind: 'OVERTIME', id, starts_at: startIso, ends_at: endIso, all_day: false,
  manila_date: startIso.slice(0, 10), ...extra,
});

describe('placeDay (Manila time)', () => {
  it('places an entry that starts before 8 AM Manila on the Manila day, not the UTC day', () => {
    // 06:00 to 09:00 Manila on Oct 26 is 22:00Z Oct 25 to 01:00Z Oct 26.
    const e = timedEntry('a', '2026-10-25T22:00:00Z', '2026-10-26T01:00:00Z', { manila_date: '2026-10-26' });
    const day = placeDay([e], '2026-10-26');
    expect(day.timed).toHaveLength(1);
    expect(day.timed[0].startMin).toBe(6 * 60);
    expect(day.timed[0].endMin).toBe(9 * 60);
    expect(placeDay([e], '2026-10-25').timed).toHaveLength(0);
  });

  it('puts all-day and window-less entries in the all-day row', () => {
    const a = { kind: 'SIL', id: 'x', all_day: true, manila_date: '2026-10-26', starts_at: null, ends_at: null };
    const b = { kind: 'OFFSET', id: 'y', all_day: false, manila_date: '2026-10-26', starts_at: null, ends_at: null };
    const day = placeDay([a, b], '2026-10-26');
    expect(day.allDay).toHaveLength(2);
    expect(day.timed).toHaveLength(0);
    expect(placeDay([a], '2026-10-27').allDay).toHaveLength(0);
  });

  it('clips an entry that crosses midnight to each day', () => {
    const e = timedEntry('c', '2026-10-26T14:00:00Z', '2026-10-26T18:00:00Z'); // 22:00 to 02:00 Manila
    expect(placeDay([e], '2026-10-26').timed[0]).toMatchObject({ startMin: 22 * 60, endMin: 24 * 60 });
    expect(placeDay([e], '2026-10-27').timed[0]).toMatchObject({ startMin: 0, endMin: 2 * 60 });
  });
});

describe('assignLanes', () => {
  it('puts overlapping blocks in separate lanes sharing a lane count', () => {
    const out = assignLanes([
      { id: 1, startMin: 540, endMin: 660 },
      { id: 2, startMin: 600, endMin: 720 },
      { id: 3, startMin: 900, endMin: 960 },
    ]);
    const by = Object.fromEntries(out.map((b) => [b.id, b]));
    expect(by[1]).toMatchObject({ lane: 0, lanes: 2 });
    expect(by[2]).toMatchObject({ lane: 1, lanes: 2 });
    expect(by[3]).toMatchObject({ lane: 0, lanes: 1 });
  });

  it('reuses a free lane', () => {
    const out = assignLanes([
      { id: 1, startMin: 0, endMin: 120 },
      { id: 2, startMin: 60, endMin: 180 },
      { id: 3, startMin: 120, endMin: 200 },
    ]);
    expect(out.find((b) => b.id === 3)).toMatchObject({ lane: 0, lanes: 2 });
  });
});
