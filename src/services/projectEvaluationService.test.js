import { beforeEach, describe, expect, it } from "vitest"
import { projectEvaluationService } from "./projectEvaluationService"
import { db } from "@/test/db/store"
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
 * Canvass on a Procurement Request (issue #46), exercised through the
 * service's public methods against the fake PostgREST.
 *
 * What is asserted is what a purchaser and an accountant would read back: the
 * offers recorded, which one won, and that a Canvass never drifts onto the
 * wrong subject or ends up with two winners — never the shape of the writes
 * that got there.
 */
describe("projectEvaluationService — canvass", () => {
  let purchaser
  let opportunity
  let request

  beforeEach(() => {
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true })
    opportunity = makeOpportunity({ registered_by: purchaser.id, sales_reference: "S04602" })
    request = db.seed("sor_procurement_requests", {
      opportunity_id: opportunity.id,
      requested_name: "Boom Lift 12m",
      requested_by: purchaser.id,
    })
  })

  describe("subject", () => {
    it("refuses a Canvass with neither a Procurement Request nor an Inclusion", async () => {
      await expect(projectEvaluationService.getCanvass({})).rejects.toThrow(
        /exactly one Procurement Request or Inclusion/,
      )
    })

    it("refuses a Canvass claiming to belong to both", async () => {
      await expect(
        projectEvaluationService.getCanvass({
          procurementRequestId: request.id,
          inclusionId: "some-inclusion",
        }),
      ).rejects.toThrow(/exactly one Procurement Request or Inclusion/)
    })
  })

  describe("starting a canvass", () => {
    it("has no Canvass until somebody starts one", async () => {
      expect(
        await projectEvaluationService.getCanvass({ procurementRequestId: request.id }),
      ).toBeNull()
    })

    it("creates an empty Canvass on first touch", async () => {
      const canvass = await projectEvaluationService.getOrCreateCanvass(
        { procurementRequestId: request.id },
        purchaser.id,
      )

      expect(canvass.procurement_request_id).toBe(request.id)
      expect(canvass.offers).toEqual([])
    })

    it("reuses the existing Canvass rather than creating a second one", async () => {
      const first = await projectEvaluationService.getOrCreateCanvass(
        { procurementRequestId: request.id },
        purchaser.id,
      )
      const second = await projectEvaluationService.getOrCreateCanvass(
        { procurementRequestId: request.id },
        purchaser.id,
      )

      expect(second.id).toBe(first.id)
      expect(db.rows("sor_canvasses")).toHaveLength(1)
    })
  })

  describe("recording offers", () => {
    let canvass

    beforeEach(async () => {
      canvass = await projectEvaluationService.getOrCreateCanvass(
        { procurementRequestId: request.id },
        purchaser.id,
      )
    })

    it("keeps brand, price, lead time and quality — not price alone", async () => {
      await projectEvaluationService.addOffer(
        canvass.id,
        {
          brand: "Genie",
          description: "GS-3246 scissor lift",
          sourceLink: "https://example.com/genie",
          unitPrice: 850000,
          leadTime: "6-8 weeks",
          qualityNote: "OEM, 2-year warranty",
        },
        purchaser.id,
      )

      const { offers } = await projectEvaluationService.getCanvass({
        procurementRequestId: request.id,
      })
      expect(offers).toHaveLength(1)
      expect(offers[0]).toMatchObject({
        brand: "Genie",
        unit_price: 850000,
        lead_time: "6-8 weeks",
        quality_note: "OEM, 2-year warranty",
      })
    })

    it("refuses an offer with neither a brand nor a description", async () => {
      await expect(
        projectEvaluationService.addOffer(canvass.id, {}, purchaser.id),
      ).rejects.toThrow(/brand or a description/i)
    })

    it("keeps the order offers were entered in", async () => {
      await projectEvaluationService.addOffer(canvass.id, { brand: "First" }, purchaser.id)
      await projectEvaluationService.addOffer(canvass.id, { brand: "Second" }, purchaser.id)
      await projectEvaluationService.addOffer(canvass.id, { brand: "Third" }, purchaser.id)

      const { offers } = await projectEvaluationService.getCanvass({
        procurementRequestId: request.id,
      })
      expect(offers.map((o) => o.brand)).toEqual(["First", "Second", "Third"])
    })

    it("edits only the fields it was given", async () => {
      const offer = await projectEvaluationService.addOffer(
        canvass.id,
        { brand: "Genie", remarks: "Local stock" },
        purchaser.id,
      )
      await projectEvaluationService.updateOffer(offer.id, { unitPrice: 900000 })

      const { offers } = await projectEvaluationService.getCanvass({
        procurementRequestId: request.id,
      })
      expect(offers[0]).toMatchObject({ brand: "Genie", remarks: "Local stock", unit_price: 900000 })
    })

    it("removes an offer outright", async () => {
      const offer = await projectEvaluationService.addOffer(canvass.id, { brand: "Drop me" }, purchaser.id)
      await projectEvaluationService.removeOffer(offer.id)

      const { offers } = await projectEvaluationService.getCanvass({
        procurementRequestId: request.id,
      })
      expect(offers).toEqual([])
    })

    it("can be saved with any number of offers, including none", async () => {
      const canvassOnly = await projectEvaluationService.getCanvass({
        procurementRequestId: request.id,
      })
      expect(canvassOnly.offers).toEqual([])
    })
  })

  describe("marking a winner", () => {
    let canvass
    let offerA
    let offerB

    beforeEach(async () => {
      canvass = await projectEvaluationService.getOrCreateCanvass(
        { procurementRequestId: request.id },
        purchaser.id,
      )
      offerA = await projectEvaluationService.addOffer(canvass.id, { brand: "A" }, purchaser.id)
      offerB = await projectEvaluationService.addOffer(canvass.id, { brand: "B" }, purchaser.id)
    })

    it("marks the chosen offer the winner", async () => {
      await projectEvaluationService.markWinner(canvass.id, offerA.id)

      const { offers } = await projectEvaluationService.getCanvass({
        procurementRequestId: request.id,
      })
      expect(offers.find((o) => o.id === offerA.id).is_winner).toBe(true)
    })

    // At most one winner exists at any time — never two, even mid-change.
    it("clears the previous winner when a new one is chosen", async () => {
      await projectEvaluationService.markWinner(canvass.id, offerA.id)
      await projectEvaluationService.markWinner(canvass.id, offerB.id)

      const { offers } = await projectEvaluationService.getCanvass({
        procurementRequestId: request.id,
      })
      expect(offers.filter((o) => o.is_winner)).toHaveLength(1)
      expect(offers.find((o) => o.id === offerB.id).is_winner).toBe(true)
      expect(offers.find((o) => o.id === offerA.id).is_winner).toBe(false)
    })

    it("refuses to crown an offer from a different Canvass", async () => {
      const otherRequest = db.seed("sor_procurement_requests", {
        opportunity_id: opportunity.id,
        requested_name: "Something else",
        requested_by: purchaser.id,
      })
      const otherCanvass = await projectEvaluationService.getOrCreateCanvass(
        { procurementRequestId: otherRequest.id },
        purchaser.id,
      )
      const otherOffer = await projectEvaluationService.addOffer(
        otherCanvass.id,
        { brand: "Elsewhere" },
        purchaser.id,
      )

      await expect(
        projectEvaluationService.markWinner(canvass.id, otherOffer.id),
      ).rejects.toThrow(/isn't part of this Canvass/)
    })
  })

  describe("signing off", () => {
    it("records who signed off and when, even under the three-offer minimum", async () => {
      const canvass = await projectEvaluationService.getOrCreateCanvass(
        { procurementRequestId: request.id },
        purchaser.id,
      )
      await projectEvaluationService.addOffer(canvass.id, { brand: "Only one" }, purchaser.id)

      const signed = await projectEvaluationService.signOffCanvass(canvass.id, purchaser.id)

      expect(signed.signed_off_by).toBe(purchaser.id)
      expect(signed.signed_off_at).toBeTruthy()
    })
  })

  describe("attaching the original spreadsheet", () => {
    it("attaches and later removes evidence", async () => {
      const canvass = await projectEvaluationService.getOrCreateCanvass(
        { procurementRequestId: request.id },
        purchaser.id,
      )
      const descriptor = { url: "https://example.com/sheet.xlsx", name: "canvass.xlsx", type: "xlsx", bytes: 2048 }

      const withAttachment = await projectEvaluationService.addCanvassAttachment(canvass.id, descriptor)
      expect(withAttachment.attachments).toEqual([descriptor])

      const withoutAttachment = await projectEvaluationService.removeCanvassAttachment(
        canvass.id,
        descriptor.url,
      )
      expect(withoutAttachment.attachments).toEqual([])
    })
  })
})
