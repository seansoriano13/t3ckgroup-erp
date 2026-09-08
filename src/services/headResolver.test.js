import { describe, expect, it } from "vitest"
import { headResolver } from "./headResolver"

/**
 * The shared department-head matching rule (issue #137): a sub-department
 * head wins over a department-level one, and a department head only owns
 * employees with no sub-department of their own. notificationService's
 * notifyHeadByDepartment and purchasingService's findHeadFor both delegate
 * here now — these tests pin the rule itself, independent of either caller.
 */
describe("headResolver", () => {
  const opsHead = { id: "h-ops", department: "OPERATIONS", sub_department: null }
  const purchasingHead = { id: "h-purchasing", department: "OPERATIONS", sub_department: "PURCHASING" }
  const itHead = { id: "h-it", department: "IT", sub_department: null }
  const heads = [opsHead, purchasingHead, itHead]

  describe("resolveHeads", () => {
    it("returns [] when neither department nor sub-department is given", () => {
      expect(headResolver.resolveHeads({}, heads)).toEqual([])
    })

    it("returns [] when there are no candidate heads", () => {
      expect(headResolver.resolveHeads({ department: "IT" }, [])).toEqual([])
      expect(headResolver.resolveHeads({ department: "IT" }, null)).toEqual([])
    })

    it("matches a sub-department head over a department-level one", () => {
      const matches = headResolver.resolveHeads(
        { department: "OPERATIONS", sub_department: "PURCHASING" },
        heads,
      )
      expect(matches[0]).toBe(purchasingHead)
    })

    it("falls back to the department head when there is no sub-department match", () => {
      const matches = headResolver.resolveHeads(
        { department: "OPERATIONS", sub_department: "WAREHOUSING" },
        heads,
      )
      expect(matches).toEqual([opsHead])
    })

    it("falls back to the department head even when the target's own sub-department has no head of its own", () => {
      const matches = headResolver.resolveHeads(
        { department: "IT", sub_department: "NETWORKS" },
        heads,
      )
      expect(matches).toEqual([itHead])
    })

    it("is case- and whitespace-insensitive", () => {
      const matches = headResolver.resolveHeads(
        { department: "  operations  ", sub_department: " purchasing " },
        heads,
      )
      expect(matches[0]).toBe(purchasingHead)
    })

    it("returns every match, ranked sub-department-first, with no duplicates", () => {
      const dualHead = { id: "h-dual", department: "OPERATIONS", sub_department: "PURCHASING" }
      const matches = headResolver.resolveHeads(
        { department: "OPERATIONS", sub_department: "PURCHASING" },
        [opsHead, purchasingHead, dualHead],
      )
      // Sub-department matches (purchasingHead, dualHead) rank ahead of the
      // department-level fallback (opsHead), which still qualifies because it
      // has no sub-department of its own.
      expect(matches).toEqual([purchasingHead, dualHead, opsHead])
    })
  })

  describe("resolveHead", () => {
    // Pre-fill (issue #138) is only safe when there is exactly one match at
    // the winning tier — zero or several must leave the field for the
    // applicant to fill in themselves, not silently guess.
    it("returns null when there are zero heads", () => {
      expect(headResolver.resolveHead({ department: "SALES" }, heads)).toBeNull()
      expect(headResolver.resolveHead({ department: "OPERATIONS" }, [])).toBeNull()
    })

    it("returns the single match", () => {
      expect(
        headResolver.resolveHead({ department: "OPERATIONS", sub_department: "PURCHASING" }, heads),
      ).toBe(purchasingHead)
    })

    it("resolves a sub-department head even though a lower-ranked department head also exists — not ambiguous, since sub-department strictly outranks department", () => {
      expect(
        headResolver.resolveHead({ department: "OPERATIONS", sub_department: "PURCHASING" }, heads),
      ).toBe(purchasingHead)
    })

    it("returns null when two heads tie at the sub-department level", () => {
      const secondPurchasingHead = { id: "h-purchasing-2", department: "OPERATIONS", sub_department: "PURCHASING" }
      const result = headResolver.resolveHead(
        { department: "OPERATIONS", sub_department: "PURCHASING" },
        [...heads, secondPurchasingHead],
      )
      expect(result).toBeNull()
    })

    it("returns null when two heads tie at the department level with no sub-department head available", () => {
      const secondOpsHead = { id: "h-ops-2", department: "OPERATIONS", sub_department: null }
      const result = headResolver.resolveHead(
        { department: "OPERATIONS", sub_department: "WAREHOUSING" },
        [opsHead, secondOpsHead, itHead],
      )
      expect(result).toBeNull()
    })
  })
})
