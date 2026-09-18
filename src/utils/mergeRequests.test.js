import { describe, expect, it } from 'vitest';
import { mergeRequestRows } from './mergeRequests';

describe('mergeRequestRows', () => {
  it('tags each row with its type and orders newest-first', () => {
    const merged = mergeRequestRows({
      OFFSET: [{ id: 'o1', date: '2026-03-01', created_at: '2026-03-01T00:00:00Z' }],
      OVERTIME: [{ id: 'ot1', date: '2026-03-05', created_at: '2026-03-05T00:00:00Z' }],
    });

    expect(merged.map((r) => r.type)).toEqual(['OVERTIME', 'OFFSET']);
  });

  it('collapses a multi-day application sharing a leave_group_id into one row', () => {
    const merged = mergeRequestRows({
      SIL: [
        { id: 's1', leave_group_id: 'g1', date: '2026-03-10', hours: 8, created_at: '2026-03-10T00:00:00Z' },
        { id: 's2', leave_group_id: 'g1', date: '2026-03-11', hours: 8, created_at: '2026-03-10T00:00:00Z' },
      ],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ dayCount: 2, hours: 16, type: 'SIL' });
  });

  it('drops a row that appears in both the pending and history sources for the same type', () => {
    const pendingRow = { id: 'ot1', date: '2026-03-05', created_at: '2026-03-05T00:00:00Z' };
    const merged = mergeRequestRows({
      OVERTIME: [pendingRow, pendingRow],
    });

    expect(merged).toHaveLength(1);
  });

  it('does not merge rows of different types that happen to share an id', () => {
    const merged = mergeRequestRows({
      OFFSET: [{ id: 'shared-id', date: '2026-03-01', created_at: '2026-03-01T00:00:00Z' }],
      SIL: [{ id: 'shared-id', date: '2026-03-02', created_at: '2026-03-02T00:00:00Z' }],
    });

    expect(merged).toHaveLength(2);
  });
});
