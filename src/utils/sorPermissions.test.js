import { describe, it, expect } from 'vitest';
import { canEditSor } from './sorPermissions';

describe('canEditSor predicate', () => {
  const sor = {
    registered_by: 'user-reg',
    deal_owner_id: 'user-owner',
    support_sales_1_id: 'user-support1',
    support_sales_2_id: 'user-support2',
    sales_director_id: 'user-dir',
  };

  it('returns false if user or sor is missing', () => {
    expect(canEditSor(null, sor)).toBe(false);
    expect(canEditSor({ id: 'user-1' }, null)).toBe(false);
  });

  it('returns true for heads and super admins regardless of deal fields', () => {
    expect(canEditSor({ id: 'user-random', is_head: true }, sor)).toBe(true);
    expect(canEditSor({ id: 'user-random', isHead: true }, sor)).toBe(true);
    expect(canEditSor({ id: 'user-random', is_super_admin: true }, sor)).toBe(true);
    expect(canEditSor({ id: 'user-random', isSuperAdmin: true }, sor)).toBe(true);
  });

  it('returns true for any employee explicitly listed on the deal', () => {
    expect(canEditSor({ id: 'user-reg' }, sor)).toBe(true);
    expect(canEditSor({ id: 'user-owner' }, sor)).toBe(true);
    expect(canEditSor({ id: 'user-support1' }, sor)).toBe(true);
    expect(canEditSor({ id: 'user-support2' }, sor)).toBe(true);
    expect(canEditSor({ id: 'user-dir' }, sor)).toBe(true);
  });

  it('returns false for an employee not listed on the deal', () => {
    expect(canEditSor({ id: 'user-other' }, sor)).toBe(false);
  });
});
