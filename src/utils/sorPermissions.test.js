import { describe, it, expect } from 'vitest';
import { canRemoveParticipant } from './sorPermissions';

describe('canRemoveParticipant', () => {
  const sor = { deal_owner_id: 'user-owner' };

  it('is false without a user or sor', () => {
    expect(canRemoveParticipant(null, sor)).toBe(false);
    expect(canRemoveParticipant({ id: 'u' }, null)).toBe(false);
  });

  it('allows the deal owner and super admins only', () => {
    expect(canRemoveParticipant({ id: 'user-owner' }, sor)).toBe(true);
    expect(canRemoveParticipant({ id: 'x', isSuperAdmin: true }, sor)).toBe(true);
    expect(canRemoveParticipant({ id: 'x', isHead: true }, sor)).toBe(false);
  });
});
