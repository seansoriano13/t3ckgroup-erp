import { beforeEach, describe, expect, it } from "vitest"
import { opportunityService } from "./opportunityService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { waitForNetworkIdle } from "@/test/network"

/**
 * Sales Opportunity Registration, exercised end to end through the service's
 * public methods against the fake PostgREST. Registration order settles
 * commission disputes and stage moves are the audit trail, so what is asserted
 * here is what the next person reads out of the system, not how the service
 * got there.
 */
describe("opportunityService", () => {
  let registrar
  let owner

  beforeEach(() => {
    registrar = makeEmployee({ name: "Ana Reyes" })
    owner = makeEmployee({ name: "Ben Cruz" })
  })

  const payload = (overrides = {}) => ({
    registration_date: "2026-03-01",
    lead_source: "LGU",
    client_name: "Quezon City Hall",
    project_title: "Fire truck supply",
    project_type: "SSP",
    deal_owner_id: owner.id,
    items: [{ product_name: "Pumper", quantity: 2, unit_price: 1500 }],
    ...overrides,
  })

  describe("registering an opportunity", () => {
    it("makes the new opportunity retrievable by id", async () => {
      const created = await opportunityService.createOpportunity(payload(), registrar.id)

      const found = await opportunityService.getOpportunityById(created.id)
      expect(found).toMatchObject({
        client_name: "Quezon City Hall",
        project_title: "Fire truck supply",
        status: "LEAD",
      })
    })

    it("takes its opportunity number from the database sequence", async () => {
      const first = await opportunityService.createOpportunity(payload(), registrar.id)
      const second = await opportunityService.createOpportunity(payload(), registrar.id)

      expect(first.opportunity_no).toBe("S07190")
      expect(second.opportunity_no).toBe("S07191")
    })

    it("values the opportunity from its product list", async () => {
      const created = await opportunityService.createOpportunity(
        payload({
          items: [
            { product_name: "Pumper", quantity: 2, unit_price: 1500 },
            { product_name: "Ladder", quantity: 3, unit_price: 500 },
          ],
        }),
        registrar.id,
      )

      expect(created.expected_value).toBe(4500)
    })

    it("records the registration on the opportunity's timeline", async () => {
      const created = await opportunityService.createOpportunity(payload(), registrar.id)

      const notes = await opportunityService.getNotes(created.id)
      expect(notes).toHaveLength(1)
      expect(notes[0]).toMatchObject({ type: "SYSTEM", author_id: registrar.id })
      expect(notes[0].content).toBe(
        "Opportunity S07190 registered — Quezon City Hall, ₱3,000.00.",
      )
    })

    it("attributes the registration to the actor, not the deal owner", async () => {
      const created = await opportunityService.createOpportunity(payload(), registrar.id)

      expect(created.registered_by).toBe(registrar.id)
      expect(created.registrar.name).toBe("Ana Reyes")
      expect(created.deal_owner.name).toBe("Ben Cruz")
    })

    it("stores the product list in the order it was entered", async () => {
      const created = await opportunityService.createOpportunity(
        payload({
          items: [
            { product_name: "Second", quantity: 1, unit_price: 10 },
            { product_name: "First", quantity: 1, unit_price: 10 },
          ],
        }),
        registrar.id,
      )

      const items = await opportunityService.getItems(created.id)
      expect(items.map((i) => i.product_name)).toEqual(["Second", "First"])
    })

    it("rejects a sales reference that is not an Odoo quotation number", async () => {
      await expect(
        opportunityService.createOpportunity(
          payload({ sales_reference: "not-a-quote" }),
          registrar.id,
        ),
      ).rejects.toThrow(/Odoo quotation number/i)
    })

    it("accepts a lower-cased sales reference and stores it upper-cased", async () => {
      const created = await opportunityService.createOpportunity(
        payload({ sales_reference: " s01237 " }),
        registrar.id,
      )

      expect(created.sales_reference).toBe("S01237")
    })
  })

  describe("listing opportunities", () => {
    it("returns the newest registration first", async () => {
      makeOpportunity({ registered_by: registrar.id, registration_date: "2026-01-15", client_name: "Older" })
      makeOpportunity({ registered_by: registrar.id, registration_date: "2026-05-20", client_name: "Newer" })

      const list = await opportunityService.getOpportunities()

      expect(list.map((o) => o.client_name)).toEqual(["Newer", "Older"])
    })

    it("hides opportunities that were deleted", async () => {
      const kept = makeOpportunity({ registered_by: registrar.id, client_name: "Kept" })
      const removed = makeOpportunity({ registered_by: registrar.id, client_name: "Removed" })
      await opportunityService.deleteOpportunity(removed.id, registrar.id)

      const list = await opportunityService.getOpportunities()

      expect(list.map((o) => o.id)).toEqual([kept.id])
    })

    it("returns null for a missing id rather than throwing", async () => {
      expect(await opportunityService.getOpportunityById(null)).toBeNull()
    })
  })

  describe("moving through the pipeline", () => {
    it("refuses to leave Lead without a sales reference on record", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id })

      await expect(
        opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id),
      ).rejects.toThrow(/Sales Reference is required/i)

      const unchanged = await opportunityService.getOpportunityById(lead.id)
      expect(unchanged.status).toBe("LEAD")
    })

    it("advances when the sales reference is supplied with the move", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id })

      const moved = await opportunityService.updateStatus(
        lead.id,
        "QUALIFIED",
        registrar.id,
        null,
        "S01237",
      )

      expect(moved.status).toBe("QUALIFIED")
      expect(moved.sales_reference).toBe("S01237")
    })

    it("advances when a sales reference is already on record", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      const moved = await opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id)

      expect(moved.status).toBe("QUALIFIED")
    })

    it("lets a lead be closed as lost before it was ever quoted", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id })

      const moved = await opportunityService.updateStatus(
        lead.id,
        "CLOSED_LOST",
        registrar.id,
        "Client cancelled the procurement",
      )

      expect(moved.status).toBe("CLOSED_LOST")
      expect(moved.lost_reason).toBe("Client cancelled the procurement")
    })

    it("clears the lost reason when a closed-lost deal is revived", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })
      await opportunityService.updateStatus(lead.id, "CLOSED_LOST", registrar.id, "Budget cut")

      const revived = await opportunityService.updateStatus(lead.id, "NEGOTIATION", registrar.id)

      expect(revived.lost_reason).toBeNull()
    })

    it("does nothing when the stage has not actually changed", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id })

      await opportunityService.updateStatus(lead.id, "LEAD", registrar.id)

      expect(await opportunityService.getNotes(lead.id)).toEqual([])
    })

    it("writes the move onto the timeline in human terms", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id)

      const notes = await opportunityService.getNotes(lead.id)
      expect(notes.at(-1).content).toBe("Stage moved: Lead → Proposal Submitted")
      expect(notes.at(-1).metadata).toMatchObject({
        event: "STAGE_CHANGED",
        from: "LEAD",
        to: "PROPOSAL_SUBMITTED",
      })
    })

    it("names the reason on the timeline when a deal is lost", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id })

      await opportunityService.updateStatus(lead.id, "CLOSED_LOST", registrar.id, "Lost on price")

      const notes = await opportunityService.getNotes(lead.id)
      expect(notes.at(-1).content).toBe("Stage moved: Lead → Closed Lost — Lost on price")
    })

    it("records the sales reference separately from the stage move", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id })

      await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id, null, "S01237")

      const notes = await opportunityService.getNotes(lead.id)
      expect(notes.map((n) => n.content)).toEqual([
        "Sales Reference recorded: S01237",
        "Stage moved: Lead → Proposal Submitted",
      ])
    })

    it("does not re-record a sales reference that is already the one on file", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S01237" })

      await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id, null, "S01237")

      const notes = await opportunityService.getNotes(lead.id)
      expect(notes.map((n) => n.content)).toEqual(["Stage moved: Lead → Proposal Submitted"])
    })

    it("rejects a malformed sales reference before touching the record", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id })

      await expect(
        opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id, null, "12345"),
      ).rejects.toThrow(/Odoo quotation number/i)

      expect(await opportunityService.getNotes(lead.id)).toEqual([])
    })
  })

  describe("editing an opportunity", () => {
    it("saves the edited fields", async () => {
      const created = await opportunityService.createOpportunity(payload(), registrar.id)

      await opportunityService.updateOpportunity(
        created.id,
        payload({ client_name: "Pasig City Hall", contact_person: "Engr. Santos" }),
        registrar.id,
      )

      const found = await opportunityService.getOpportunityById(created.id)
      expect(found).toMatchObject({
        client_name: "Pasig City Hall",
        contact_person: "Engr. Santos",
      })
    })

    it("describes what changed on the timeline", async () => {
      const created = await opportunityService.createOpportunity(payload(), registrar.id)

      await opportunityService.updateOpportunity(
        created.id,
        payload({ client_name: "Pasig City Hall" }),
        registrar.id,
      )

      const notes = await opportunityService.getNotes(created.id)
      expect(notes.at(-1).content).toContain(
        'Client changed from "Quezon City Hall" to "Pasig City Hall"',
      )
    })

    it("names the people involved rather than their ids", async () => {
      const created = await opportunityService.createOpportunity(payload(), registrar.id)
      const newOwner = makeEmployee({ name: "Cara Lim" })

      await opportunityService.updateOpportunity(
        created.id,
        payload({ deal_owner_id: newOwner.id }),
        registrar.id,
      )

      const notes = await opportunityService.getNotes(created.id)
      expect(notes.at(-1).content).toContain('Deal Owner changed from "Ben Cruz" to "Cara Lim"')
    })

    it("reports added, removed and modified products by name", async () => {
      const created = await opportunityService.createOpportunity(
        payload({
          items: [
            { product_name: "[SKU-1] Pumper", quantity: 1, unit_price: 100 },
            { product_name: "[SKU-2] Ladder", quantity: 1, unit_price: 200 },
          ],
        }),
        registrar.id,
      )

      await opportunityService.updateOpportunity(
        created.id,
        payload({
          items: [
            { product_name: "[SKU-1] Pumper", quantity: 5, unit_price: 100 },
            { product_name: "[SKU-3] Hose", quantity: 1, unit_price: 50 },
          ],
        }),
        registrar.id,
      )

      const content = (await opportunityService.getNotes(created.id)).at(-1).content
      expect(content).toContain("Added product(s): Hose")
      expect(content).toContain("Removed product(s): Ladder")
      expect(content).toContain("Modified product(s): Pumper")
    })

    it("revalues the opportunity when the product list changes", async () => {
      const created = await opportunityService.createOpportunity(payload(), registrar.id)

      const updated = await opportunityService.updateOpportunity(
        created.id,
        payload({ items: [{ product_name: "Pumper", quantity: 10, unit_price: 1500 }] }),
        registrar.id,
      )

      expect(updated.expected_value).toBe(15000)
    })

    it("writes no change note when nothing actually changed", async () => {
      const created = await opportunityService.createOpportunity(payload(), registrar.id)
      const before = await opportunityService.getNotes(created.id)

      await opportunityService.updateOpportunity(created.id, payload(), registrar.id)

      expect(await opportunityService.getNotes(created.id)).toHaveLength(before.length)
    })
  })

  describe("the product list", () => {
    it("drops rows with no product name", async () => {
      const created = await opportunityService.createOpportunity(
        payload({
          items: [
            { product_name: "Pumper", quantity: 1, unit_price: 100 },
            { product_name: "   ", quantity: 1, unit_price: 999 },
            { product_name: "", quantity: 1, unit_price: 999 },
          ],
        }),
        registrar.id,
      )

      const items = await opportunityService.getItems(created.id)
      expect(items.map((i) => i.product_name)).toEqual(["Pumper"])
    })

    it("treats a blank quantity or price as zero rather than storing null", async () => {
      const created = await opportunityService.createOpportunity(
        payload({ items: [{ product_name: "Pumper", quantity: "", unit_price: undefined }] }),
        registrar.id,
      )

      const [item] = await opportunityService.getItems(created.id)
      expect(item).toMatchObject({ quantity: 0, unit_price: 0 })
    })

    it("replaces the whole list instead of appending to it", async () => {
      const created = await opportunityService.createOpportunity(payload(), registrar.id)

      await opportunityService.replaceItems(created.id, [
        { product_name: "Replacement", quantity: 1, unit_price: 10 },
      ])

      const items = await opportunityService.getItems(created.id)
      expect(items.map((i) => i.product_name)).toEqual(["Replacement"])
    })

    it("returns an empty list for an opportunity with no id", async () => {
      expect(await opportunityService.getItems(null)).toEqual([])
    })
  })

  describe("notes", () => {
    it("stores a comment against its author", async () => {
      const opportunity = makeOpportunity({ registered_by: registrar.id })

      const note = await opportunityService.addNote(
        opportunity.id,
        registrar.id,
        "Client asked for a revised BOM",
      )

      expect(note).toMatchObject({ type: "COMMENT", content: "Client asked for a revised BOM" })
      expect(note.author.name).toBe("Ana Reyes")
    })

    it("accepts a note that is only attachments", async () => {
      const opportunity = makeOpportunity({ registered_by: registrar.id })

      const note = await opportunityService.addNote(opportunity.id, registrar.id, "", [
        { url: "https://res.cloudinary.test/quote.pdf", name: "quote.pdf" },
      ])

      expect(note.content).toBe("")
      expect(note.metadata.attachments).toHaveLength(1)
    })

    it("rejects a note with neither text nor a file", async () => {
      const opportunity = makeOpportunity({ registered_by: registrar.id })

      await expect(
        opportunityService.addNote(opportunity.id, registrar.id, "   "),
      ).rejects.toThrow("Add a note or attach a file.")
    })

    it("ignores attachment entries that never finished uploading", async () => {
      const opportunity = makeOpportunity({ registered_by: registrar.id })

      const note = await opportunityService.addNote(opportunity.id, registrar.id, "See attached", [
        { url: "https://res.cloudinary.test/ok.pdf" },
        { name: "failed.pdf" },
      ])

      expect(note.metadata.attachments).toHaveLength(1)
    })

    it("reads the timeline oldest first", async () => {
      const opportunity = makeOpportunity({ registered_by: registrar.id })
      await opportunityService.addNote(opportunity.id, registrar.id, "First")
      await opportunityService.addNote(opportunity.id, registrar.id, "Second")

      const notes = await opportunityService.getNotes(opportunity.id)

      expect(notes.map((n) => n.content)).toEqual(["First", "Second"])
    })

    it("returns an empty timeline for a missing opportunity id", async () => {
      expect(await opportunityService.getNotes(null)).toEqual([])
    })
  })

  describe("deleting an opportunity", () => {
    it("keeps the record for audit rather than erasing it", async () => {
      const opportunity = makeOpportunity({ registered_by: registrar.id })

      await opportunityService.deleteOpportunity(opportunity.id, registrar.id)

      const stored = db.rows("sales_opportunities").find((o) => o.id === opportunity.id)
      expect(stored.is_deleted).toBe(true)
    })
  })

  describe("the audit log", () => {
    it("records registration for the super-admin activity feed", async () => {
      const created = await opportunityService.createOpportunity(payload(), registrar.id)
      await waitForNetworkIdle()

      const [entry] = db.rows("system_audit_logs")
      expect(entry).toMatchObject({
        entity_type: "OPPORTUNITY",
        entity_id: created.id,
        author_id: registrar.id,
      })
      expect(entry.content).toContain("registered for Quezon City Hall")
    })

    it("records a stage move", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      await opportunityService.updateStatus(lead.id, "AWARDED", registrar.id)
      await waitForNetworkIdle()

      expect(
        db.rows("system_audit_logs").some((e) => e.content.includes("Lead → Awarded")),
      ).toBe(true)
    })
  })
})
