import { describe, it, expect } from 'vitest';
import { isViolation } from './no-primary-decoration.js';

describe('no-primary-decoration lint rule', () => {
  describe('isViolation pure predicate', () => {
    it('returns true for a primary-tinted focus ring on an ordinary input', () => {
      expect(isViolation('focus-visible:ring-primary', 'src/components/ui/input.jsx')).toBe(true);
    });

    it('returns false for the same utility inside an allowlisted component', () => {
      expect(isViolation('focus-visible:ring-primary', 'src/components/ui/button.jsx')).toBe(false);
      expect(isViolation('bg-primary text-primary-foreground', 'src/components/ui/ConfirmDialog.jsx')).toBe(false);
    });

    it('returns false for a neutral utility everywhere', () => {
      expect(isViolation('bg-muted text-foreground ring-offset-background', 'src/components/ui/input.jsx')).toBe(false);
    });

    it('returns false for primary-foreground', () => {
      expect(isViolation('text-primary-foreground', 'src/components/ui/Badge.jsx')).toBe(false);
    });

    it('returns true for a class string mixing allowed and disallowed utilities', () => {
      expect(isViolation('px-4 py-2 bg-primary rounded-md text-sm', 'src/pages/hr/LeavePage.jsx')).toBe(true);
    });

    it('handles conditional and template-interpolated class strings safely', () => {
      expect(isViolation(undefined, 'src/components/ui/card.jsx')).toBe(false);
      expect(isViolation(null, 'src/components/ui/card.jsx')).toBe(false);
      expect(isViolation('', 'src/components/ui/card.jsx')).toBe(false);
      expect(isViolation('   ', 'src/components/ui/card.jsx')).toBe(false);
      // The rule itself does not evaluate the conditional JS expression, 
      // but the predicate should handle whatever string it's given.
      expect(isViolation('bg-primary', 'src/components/ui/card.jsx')).toBe(true);
    });
  });
});
