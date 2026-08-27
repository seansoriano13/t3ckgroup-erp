import { beforeEach, describe, expect, it } from "vitest"
import { projectEvaluationService } from "./projectEvaluationService"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { COMPLETENESS, SOURCING, summariseCompleteness } from "@/constants/projectEvaluation"

/**
 * Inclusions (issue #43), exercised through the service's public methods
 * against the fake PostgREST.
 *
 * What is asserted is what the next person reads out of the system: what the
 * client asked for, how much of it is answered, and how each item would be
 * obtained — never how the service got there.
 */
describe("projectEvaluationService — inclusions", () => {
  let salesperson
  let opportunity

  beforeEach(() => {
    salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
    opportunity = makeOpportunity({
      registered_by: salesperson.id,
      deal_owner_id: salesperson.id,
      client_name: "Brgy. Wack-Wack",
      project_title: "Rescue Vehicle",
      sales_reference: "S04602",
    })
  })

  const add = (overrides = {}) =>
    projectEvaluationService.addInclusion(
      {
        opportunityId: opportunity.id,
        description: "Stretcher, foldable",
        quantity: 1,
        unit: "pc",
        ...overrides,
      },
      salesperson.id,
    )

  describe("entering the client's specification", () => {
    it("keeps what the client asked for, in their own words", async () => {
      await add({
        description: "Oxygen tank, 10L, with regulator and wall bracket",
        quantity: 2,
        unit: "set",
        note: "Spec sheet page 3",
      })

      const [row] = await projectEvaluationService.listInclusions(opportunity.id)
      expect(row).toMatchObject({
        description: "Oxygen tank, 10L, with regulator and wall bracket",
        quantity: 2,
        unit: "set",
        note: "Spec sheet page 3",
      })
    })

    // Defaulting the other way would make every freshly typed breakdown read
    // as a complete one.
    it("starts a new row as unanswered, not as covered", async () => {
      await add()
      const [row] = await projectEvaluationService.listInclusions(opportunity.id)
      expect(row.completeness).toBe(COMPLETENESS.MISSING)
    })

    it("leaves sourcing unassessed rather than claiming the item is on the shelf", async () => {
      await add()
      const [row] = await projectEvaluationService.listInclusions(opportunity.id)
      expect(row.sourcing).toBeNull()
    })

    it("records who entered it", async () => {
      await add()
      const [row] = await projectEvaluationService.listInclusions(opportunity.id)
      expect(row.author.name).toBe("Ana Reyes")
    })

    it("refuses a row with nothing written on it", async () => {
      await expect(add({ description: "   " })).rejects.toThrow(/needs a description/i)
      expect(await projectEvaluationService.listInclusions(opportunity.id)).toEqual([])
    })

    it("refuses a quantity that cannot be delivered", async () => {
      await expect(add({ quantity: 0 })).rejects.toThrow(/positive number/i)
      await expect(add({ quantity: -3 })).rejects.toThrow(/positive number/i)
    })

    // Two spellings of absence make every later comparison wrong.
    it("stores a blank unit as nothing at all", async () => {
      await add({ unit: "  " })
      const [row] = await projectEvaluationService.listInclusions(opportunity.id)
      expect(row.unit).toBeNull()
    })

    it("keeps the order the spec sheet was typed in", async () => {
      await add({ description: "First" })
      await add({ description: "Second" })
      await add({ description: "Third" })

      const rows = await projectEvaluationService.listInclusions(opportunity.id)
      expect(rows.map((r) => r.description)).toEqual(["First", "Second", "Third"])
    })

    it("keeps one SOR's breakdown out of another's", async () => {
      const other = makeOpportunity({ registered_by: salesperson.id })
      await add({ description: "Ours" })
      await projectEvaluationService.addInclusion(
        { opportunityId: other.id, description: "Theirs" },
        salesperson.id,
      )

      const rows = await projectEvaluationService.listInclusions(opportunity.id)
      expect(rows.map((r) => r.description)).toEqual(["Ours"])
    })
  })

  describe("entering a whole spec sheet at once", () => {
    it("keeps the order the list arrived in", async () => {
      await projectEvaluationService.addInclusions(
        opportunity.id,
        [
          { description: "Siren and light bar" },
          { description: "Stretcher, foldable" },
          { description: "First aid cabinet" },
        ],
        salesperson.id,
      )

      const rows = await projectEvaluationService.listInclusions(opportunity.id)
      expect(rows.map((r) => r.description)).toEqual([
        "Siren and light bar",
        "Stretcher, foldable",
        "First aid cabinet",
      ])
    })

    // Half a client's specification silently landing is worse than none of it.
    it("writes nothing at all if any row in the batch is bad", async () => {
      await expect(
        projectEvaluationService.addInclusions(
          opportunity.id,
          [{ description: "Good" }, { description: "" }],
          salesperson.id,
        ),
      ).rejects.toThrow(/needs a description/i)

      expect(await projectEvaluationService.listInclusions(opportunity.id)).toEqual([])
    })

    it("appends after what is already there", async () => {
      await add({ description: "Typed by hand" })
      await projectEvaluationService.addInclusions(
        opportunity.id,
        [{ description: "Imported" }],
        salesperson.id,
      )

      const rows = await projectEvaluationService.listInclusions(opportunity.id)
      expect(rows.map((r) => r.description)).toEqual(["Typed by hand", "Imported"])
    })
  })

  describe("answering the specification", () => {
    it("marks an item covered", async () => {
      const row = await add()
      await projectEvaluationService.updateInclusion(row.id, {
        completeness: COMPLETENESS.COVERED,
      })

      const [updated] = await projectEvaluationService.listInclusions(opportunity.id)
      expect(updated.completeness).toBe(COMPLETENESS.COVERED)
    })

    it("marks an item the client turned out not to need", async () => {
      const row = await add()
      await projectEvaluationService.updateInclusion(row.id, {
        completeness: COMPLETENESS.NOT_REQUIRED,
      })

      const rows = await projectEvaluationService.listInclusions(opportunity.id)
      expect(summariseCompleteness(rows).counted).toBe(0)
    })

    it("refuses a state the schema does not have", async () => {
      const row = await add()
      await expect(
        projectEvaluationService.updateInclusion(row.id, { completeness: "PENDING" }),
      ).rejects.toThrow(/not a completeness state/i)
    })

    it("touches only the fields it was given", async () => {
      const row = await add({ note: "Spec sheet page 3" })
      await projectEvaluationService.updateInclusion(row.id, {
        completeness: COMPLETENESS.COVERED,
      })

      const [updated] = await projectEvaluationService.listInclusions(opportunity.id)
      expect(updated.note).toBe("Spec sheet page 3")
      expect(updated.description).toBe("Stretcher, foldable")
    })
  })

  describe("recording how an item would be obtained", () => {
    it("distinguishes stocked-but-empty from source-out", async () => {
      const stocked = await add({ description: "Stretcher" })
      const sourced = await add({ description: "Hydraulic rescue tool" })

      await projectEvaluationService.setSourcing(
        stocked.id,
        SOURCING.STOCKABLE_NEEDS_ORDERING,
      )
      await projectEvaluationService.setSourcing(sourced.id, SOURCING.SOURCE_OUT)

      const rows = await projectEvaluationService.listInclusions(opportunity.id)
      expect(rows.map((r) => r.sourcing)).toEqual([
        SOURCING.STOCKABLE_NEEDS_ORDERING,
        SOURCING.SOURCE_OUT,
      ])
    })

    it("lets an assessment be corrected", async () => {
      const row = await add()
      await projectEvaluationService.setSourcing(row.id, SOURCING.SOURCE_OUT)
      await projectEvaluationService.setSourcing(row.id, SOURCING.STOCKABLE_AVAILABLE)

      const [updated] = await projectEvaluationService.listInclusions(opportunity.id)
      expect(updated.sourcing).toBe(SOURCING.STOCKABLE_AVAILABLE)
    })

    it("lets an assessment be cleared back to unassessed", async () => {
      const row = await add()
      await projectEvaluationService.setSourcing(row.id, SOURCING.SOURCE_OUT)
      await projectEvaluationService.setSourcing(row.id, null)

      const [updated] = await projectEvaluationService.listInclusions(opportunity.id)
      expect(updated.sourcing).toBeNull()
    })

    it("refuses a value that is not one of the three", async () => {
      const row = await add()
      await expect(
        projectEvaluationService.setSourcing(row.id, "IMPORTED"),
      ).rejects.toThrow(/not a sourcing state/i)
    })
  })

  describe("editing the breakdown", () => {
    it("removes a mis-keyed line", async () => {
      const row = await add({ description: "Typo" })
      await add({ description: "Real item" })

      await projectEvaluationService.removeInclusion(row.id)

      const rows = await projectEvaluationService.listInclusions(opportunity.id)
      expect(rows.map((r) => r.description)).toEqual(["Real item"])
    })

    it("reorders the list", async () => {
      const first = await add({ description: "First" })
      const second = await add({ description: "Second" })

      await projectEvaluationService.reorderInclusions([
        { id: second.id, sortOrder: 0 },
        { id: first.id, sortOrder: 1 },
      ])

      const rows = await projectEvaluationService.listInclusions(opportunity.id)
      expect(rows.map((r) => r.description)).toEqual(["Second", "First"])
    })
  })

  describe("what the SOR reads off the breakdown", () => {
    it("answers how much of the specification is still open", async () => {
      const covered = await add({ description: "Stretcher" })
      await add({ description: "Oxygen tank" })
      const dismissed = await add({ description: "Spare wheel" })

      await projectEvaluationService.updateInclusion(covered.id, {
        completeness: COMPLETENESS.COVERED,
      })
      await projectEvaluationService.updateInclusion(dismissed.id, {
        completeness: COMPLETENESS.NOT_REQUIRED,
      })

      const summary = summariseCompleteness(
        await projectEvaluationService.listInclusions(opportunity.id),
      )
      expect(summary).toMatchObject({ counted: 2, covered: 1, outstanding: 1, percent: 50 })
    })

    // An untouched SOR has not been assessed, which is a different statement
    // from "0% of this spec is covered".
    it("has no percentage at all on an SOR nobody has broken down", async () => {
      const summary = summariseCompleteness(
        await projectEvaluationService.listInclusions(opportunity.id),
      )
      expect(summary.percent).toBeNull()
    })
  })
})
