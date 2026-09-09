import { describe, expect, it } from "vitest"
import { canIssuePassword, canReissuePassword, generateIssuedPassword } from "./passwordPolicy"

/**
 * Seam D — the issue/reissue authorisation rules (issue #162/#164) as pure
 * predicates. The manage-employee-password edge function enforces the same
 * rules server-side (Seam A, once the real-Postgres tier exists); this is
 * what proves the rules themselves, both directions.
 */
describe("passwordPolicy", () => {
  describe("canIssuePassword", () => {
    it("permits a Super Admin", () => {
      expect(canIssuePassword({ isSuperAdmin: true, isHr: false })).toBe(true)
    })

    it("permits HR", () => {
      expect(canIssuePassword({ isSuperAdmin: false, isHr: true })).toBe(true)
    })

    it("refuses anyone else", () => {
      expect(canIssuePassword({ isSuperAdmin: false, isHr: false })).toBe(false)
    })
  })

  describe("canReissuePassword", () => {
    it("permits a Super Admin while the employee is still on their issued password", () => {
      expect(canReissuePassword({ isSuperAdmin: true, isIssuedPassword: true })).toBe(true)
    })

    it("refuses once the employee has set their own password, even for a Super Admin", () => {
      expect(canReissuePassword({ isSuperAdmin: true, isIssuedPassword: false })).toBe(false)
    })

    it("refuses a non-Super-Admin caller even while the flag is set", () => {
      expect(canReissuePassword({ isSuperAdmin: false, isIssuedPassword: true })).toBe(false)
    })

    it("refuses a non-Super-Admin caller once the flag has cleared", () => {
      expect(canReissuePassword({ isSuperAdmin: false, isIssuedPassword: false })).toBe(false)
    })
  })

  describe("generateIssuedPassword", () => {
    it("produces a password per call, and two calls never match", () => {
      const a = generateIssuedPassword()
      const b = generateIssuedPassword()
      expect(a).toBeTruthy()
      expect(b).toBeTruthy()
      expect(a).not.toBe(b)
    })
  })
})
