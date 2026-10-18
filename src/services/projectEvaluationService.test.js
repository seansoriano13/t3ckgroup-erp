import { beforeEach, describe, expect, it } from "vitest"
import { projectEvaluationService } from "./projectEvaluationService"
import { db } from "@/test/db/store"
import { stubEdgeFunction } from "@/test/msw/server"
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

/**
 * Project Evaluation — the go/no-go (issue #48), exercised through the
 * service's public methods against the fake PostgREST.
 *
 * What is asserted is what a salesperson reads off the screen: whether the
 * evaluation has a base cost yet, what the margin comes to, and whether the
 * evaluation is still just an estimate — never how the service got there.
 */
// Issue #203: Project Evaluation (the go/no-go itself, sor_project_evaluations,
// and this service's evaluation CRUD/summary-margin methods) is removed —
// the company keeps that judgment in a Google Sheet. What's left of the old
// "full summary" — base cost and actual cost, no margin — is covered under
// "actual cost > in the full cost summary" below, against getCostSummary.
describe("projectEvaluationService — cost summary (base cost only)", () => {
  let salesperson
  let opportunity

  beforeEach(() => {
    salesperson = makeEmployee({ name: "Ana Reyes" })
    opportunity = makeOpportunity({ registered_by: salesperson.id, client_name: "Brgy. Wack-Wack" })
  })

  it("reads as no base cost, not zero, on an SOR with no Inclusions", async () => {
    const summary = await projectEvaluationService.getCostSummary(opportunity.id)
    expect(summary.baseCost.amount).toBeNull()
  })

  it("rolls up base cost automatically from the SOR's costed Inclusions", async () => {
    // The Inclusion cost stamp is gone (#276), so a costed row is seeded
    // directly: the roll-up still reads cost_amount off it.
    db.seed("sor_inclusions", {
      opportunity_id: opportunity.id,
      description: "Boom Lift",
      quantity: 2,
      cost_amount: 100_000,
      created_by: salesperson.id,
    })

    const summary = await projectEvaluationService.getCostSummary(opportunity.id)
    expect(summary.baseCost.amount).toBe(200_000)
  })

  it("is unbound with no Sales Reference", async () => {
    const summary = await projectEvaluationService.getCostSummary(opportunity.id)
    expect(summary.isBound).toBe(false)
  })

  it("is bound once a Sales Reference is recorded", async () => {
    const bound = makeOpportunity({
      registered_by: salesperson.id,
      sales_reference: "S04602",
      expected_value: 950_000,
    })

    const summary = await projectEvaluationService.getCostSummary(bound.id)
    expect(summary.isBound).toBe(true)
  })
})

/**
 * Actual cost — the purchase-order rollup by Source Document (issue #49),
 * exercised through the service's public methods against the fake PostgREST
 * and a stubbed odoo-po-rollup edge function.
 *
 * What is asserted is what an accountant reads off the screen: the purchase
 * orders that count, the total, and whether Odoo could even be asked — never
 * the shape of the request sent to it.
 */
describe("projectEvaluationService — actual cost", () => {
  let accountant
  let opportunity

  beforeEach(() => {
    accountant = makeEmployee({ name: "Rico Santos" })
    opportunity = makeOpportunity({
      registered_by: accountant.id,
      sales_reference: "S04602",
      client_name: "Brgy. Wack-Wack",
    })
  })

  describe("fetchOdooPurchaseOrders", () => {
    it("returns nothing to look up when there is no Sales Reference yet", async () => {
      const result = await projectEvaluationService.fetchOdooPurchaseOrders(null)
      expect(result).toEqual({ status: "ok", orders: [] })
    })

    it("reads the orders Odoo found by Source Document", async () => {
      stubEdgeFunction("odoo-po-rollup", {
        success: true,
        orders: [
          { name: "P02560", amount_untaxed: 117, matched_by: "origin" },
          { name: "P02561", amount_untaxed: 238, matched_by: "origin" },
        ],
      })

      const result = await projectEvaluationService.fetchOdooPurchaseOrders("S04602")
      expect(result.status).toBe("ok")
      expect(result.orders).toHaveLength(2)
    })

    it("is unreachable, not an empty result, when Odoo could not be asked", async () => {
      stubEdgeFunction("odoo-po-rollup", { success: false, message: "Odoo authentication failed." })

      const result = await projectEvaluationService.fetchOdooPurchaseOrders("S04602")
      expect(result.status).toBe("unreachable")
      expect(result.orders).toEqual([])
    })

    it("is unreachable when the function itself cannot be reached at all", async () => {
      // No stubEdgeFunction registered — the fake responds 404, which
      // supabase-js surfaces as `error`, not a thrown exception.
      const result = await projectEvaluationService.fetchOdooPurchaseOrders("S04602")
      expect(result.status).toBe("unreachable")
    })
  })

  describe("attaching and detaching", () => {
    it("attaches a purchase order the rollup did not find", async () => {
      await projectEvaluationService.attachPurchaseOrder(opportunity.id, "p09999", accountant.id)

      const links = await projectEvaluationService.listPurchaseOrderLinks(opportunity.id)
      expect(links).toHaveLength(1)
      expect(links[0]).toMatchObject({ po_number: "P09999", origin: "MANUAL", is_detached: false })
    })

    it("detaches a purchase order Odoo's search wrongly matched, and it stays detached", async () => {
      stubEdgeFunction("odoo-po-rollup", {
        success: true,
        orders: [{ name: "P02561", amount_untaxed: 238 }],
      })

      await projectEvaluationService.detachPurchaseOrder(opportunity.id, "P02561")

      const rollup = await projectEvaluationService.getActualCostRollup(opportunity.id, "S04602")
      expect(rollup.orders).toEqual([])
      expect(rollup.total.amount).toBeNull()

      const links = await projectEvaluationService.listPurchaseOrderLinks(opportunity.id)
      expect(links).toMatchObject([{ po_number: "P02561", origin: "ODOO_ORIGIN", is_detached: true }])
    })

    it("un-attaches a manual PO by deleting the override, leaving no dangling row", async () => {
      await projectEvaluationService.attachPurchaseOrder(opportunity.id, "P09999", accountant.id)
      await projectEvaluationService.detachPurchaseOrder(opportunity.id, "P09999")

      expect(await projectEvaluationService.listPurchaseOrderLinks(opportunity.id)).toEqual([])
    })
  })

  describe("getActualCostRollup", () => {
    it("totals every visible order, tax-exclusive", async () => {
      stubEdgeFunction("odoo-po-rollup", {
        success: true,
        orders: [
          { name: "P02560", amount_untaxed: 117 },
          { name: "P02561", amount_untaxed: 238 },
          { name: "P02562", amount_untaxed: 375 },
        ],
      })

      const rollup = await projectEvaluationService.getActualCostRollup(opportunity.id, "S04602")
      expect(rollup.status).toBe("ok")
      expect(rollup.total).toEqual({ amount: 730, orderCount: 3 })
    })

    it("reads as no actuals yet, not zero spend, when Odoo finds nothing", async () => {
      stubEdgeFunction("odoo-po-rollup", { success: true, orders: [] })

      const rollup = await projectEvaluationService.getActualCostRollup(opportunity.id, "S04602")
      expect(rollup.total.amount).toBeNull()
    })

    it("includes a manually attached PO's real Odoo total, not a placeholder", async () => {
      await projectEvaluationService.attachPurchaseOrder(opportunity.id, "P09999", accountant.id)
      stubEdgeFunction("odoo-po-rollup", (body) => ({
        success: true,
        orders: body.additionalPoNumbers.includes("P09999")
          ? [{ name: "P09999", amount_untaxed: 5000, matched_by: "number" }]
          : [],
      }))

      const rollup = await projectEvaluationService.getActualCostRollup(opportunity.id, "S04602")
      expect(rollup.total).toEqual({ amount: 5000, orderCount: 1 })
    })
  })

  describe("in the full cost summary", () => {
    it("shows actual cost beside the estimate, with the variance, once bound", async () => {
      db.seed("sor_inclusions", {
        opportunity_id: opportunity.id,
        description: "Ambulance",
        quantity: 1,
        cost_amount: 500_000,
        created_by: accountant.id,
      })

      stubEdgeFunction("odoo-po-rollup", {
        success: true,
        orders: [{ name: "P02560", amount_untaxed: 520_000 }],
      })

      const summary = await projectEvaluationService.getCostSummary(opportunity.id)
      expect(summary.actualCost.status).toBe("ok")
      expect(summary.actualCost.total.amount).toBe(520_000)
      // The estimate (500,000) is untouched; variance is actual minus estimate.
      expect(summary.baseCost.amount).toBe(500_000)
      expect(summary.actualCost.variance).toBe(20_000)
    })

    it("has no actual cost to roll up at all on an unbound SOR", async () => {
      const unbound = makeOpportunity({ registered_by: accountant.id })

      const summary = await projectEvaluationService.getCostSummary(unbound.id)
      expect(summary.actualCost.status).toBe("ok")
      expect(summary.actualCost.total.amount).toBeNull()
    })

    it("tells the accountant Odoo could not be reached, distinct from a real empty answer", async () => {
      stubEdgeFunction("odoo-po-rollup", { success: false, message: "timed out" })

      const summary = await projectEvaluationService.getCostSummary(opportunity.id)
      expect(summary.actualCost.status).toBe("unreachable")
    })
  })
})
