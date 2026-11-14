import { describe, it, expect } from 'vitest';
import { ENTRY_KINDS } from './entryKinds.jsx';
import { TYPE_META, LEAVE_TYPES } from '../../pages/hr/offsets/_components/leaveDisplay';
import { REQUEST_TYPE_BADGE } from '../../pages/offsets/_components/requestTypes';

describe('request type colors and names (#1006)', () => {
  it.each(LEAVE_TYPES)('%s reads from the Calendar entry kinds on both lists', (type) => {
    const kind = ENTRY_KINDS[type];
    expect(TYPE_META[type]).toMatchObject({ label: kind.label, chip: kind.chip, dot: kind.dot, bar: kind.bar });
    expect(REQUEST_TYPE_BADGE[type]).toEqual({ label: kind.label, badgeClass: kind.chip });
  });

  it('LWOP and Overtime have one color on every list', () => {
    expect(TYPE_META.LWOP.chip).toBe(REQUEST_TYPE_BADGE.LWOP.badgeClass);
    expect(TYPE_META.OVERTIME.chip).toBe(REQUEST_TYPE_BADGE.OVERTIME.badgeClass);
  });
});
