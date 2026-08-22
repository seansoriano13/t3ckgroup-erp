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

    it("no longer carries an opportunity number", async () => {
      // Retired in migration 0012: it was minted as S0#### from a sequence
      // running through the same range as Odoo's quotation numbers, so an
      // opportunity showing S07233 sat beside a Sales Reference of S07189
      // while S07233 in Odoo was somebody else's order entirely.
      const created = await opportunityService.createOpportunity(payload(), registrar.id)

      expect(created.opportunity_no).toBeNull()
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
      // No identifier: the note is displayed inside the opportunity it
      // describes, and the retired opportunity_no read as an Odoo quotation
      // number without being one (migration 0012).
      expect(notes[0].content).toBe("Registered — Quezon City Hall, ₱3,000.00.")
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

    it("sets the Contract Date automatically when the opportunity is Awarded", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })
      expect(lead.contract_date).toBeFalsy()

      const awarded = await opportunityService.updateStatus(lead.id, "AWARDED", registrar.id)

      expect(awarded.contract_date).toBeTruthy()
    })

    it("does not set the Contract Date for a transition that isn't Awarded", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id })

      const moved = await opportunityService.updateStatus(
        lead.id,
        "QUALIFIED",
        registrar.id,
        null,
        "S01237",
      )

      expect(moved.contract_date).toBeFalsy()
    })

    // Found in production: all five Awarded-or-beyond opportunities carried a
    // null contract_date, so none of them was anchored to a dated Commission
    // Rate. Four had created_at == updated_at to the microsecond — registered
    // straight into a realized stage, never passing through updateStatus at
    // all — and the fifth had moved to Closed Won without stopping at Awarded.
    it("sets the Contract Date when a deal skips Awarded and lands further down the pipeline", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })
      expect(lead.contract_date).toBeFalsy()

      const won = await opportunityService.updateStatus(lead.id, "CLOSED_WON", registrar.id)

      expect(won.contract_date).toBeTruthy()
    })

    it("sets the Contract Date on an opportunity registered directly at a realized stage", async () => {
      const created = await opportunityService.createOpportunity(
        {
          registration_date: "2026-03-01",
          lead_source: "LGU",
          client_name: "Direct Award Client",
          project_title: "Registered Already Awarded",
          sales_reference: "S01500",
          status: "AWARDED",
          deal_owner_id: registrar.id,
          items: [],
        },
        registrar.id,
      )

      expect(created.contract_date).toBeTruthy()
    })

    it("leaves the Contract Date unset on an opportunity registered as a Lead", async () => {
      const created = await opportunityService.createOpportunity(
        {
          registration_date: "2026-03-01",
          lead_source: "LGU",
          client_name: "Ordinary Client",
          project_title: "Registered As Lead",
          deal_owner_id: registrar.id,
          items: [],
        },
        registrar.id,
      )

      expect(created.contract_date).toBeFalsy()
    })

    it("keeps the original Contract Date if the opportunity leaves and re-enters Awarded", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })
      const firstAward = await opportunityService.updateStatus(lead.id, "AWARDED", registrar.id)
      const firstDate = firstAward.contract_date

      await opportunityService.updateStatus(lead.id, "NEGOTIATION", registrar.id)
      const reAwarded = await opportunityService.updateStatus(lead.id, "AWARDED", registrar.id)

      expect(reAwarded.contract_date).toBe(firstDate)
    })
  })

  // The Odoo quotation number is the opportunity's identity since migration
  // 0025 retired opportunity_no — but the UNIQUE index stayed on the retired
  // column. Two pairs reached production sharing a reference, each with
  // identical contract values, and the Commission Pool counted both.
  describe("Sales Reference uniqueness", () => {
    it("refuses to register a second opportunity against the same quotation", async () => {
      makeOpportunity({ registered_by: registrar.id, sales_reference: "S08106", client_name: "Vigan City Government" })

      await expect(
        opportunityService.createOpportunity(
          {
            registration_date: "2026-08-17",
            lead_source: "LGU",
            client_name: "CPSDRRMO",
            project_title: "Smart Interactive Flat Panel Display",
            sales_reference: "S08106",
            items: [],
          },
          registrar.id,
        ),
      ).rejects.toThrow(/already registered to Vigan City Government/)
    })

    it("names the conflicting deal rather than surfacing a constraint error", async () => {
      makeOpportunity({
        registered_by: registrar.id,
        sales_reference: "S07995",
        client_name: "Drrmo Santa Lucia",
        project_title: "Coming lights",
      })

      await expect(
        opportunityService.createOpportunity(
          {
            registration_date: "2026-08-18",
            lead_source: "LGU",
            client_name: "Santa Lucia Ilocos Sur",
            project_title: "Rescue Equipment",
            sales_reference: "S07995",
            items: [],
          },
          registrar.id,
        ),
      ).rejects.toThrow(/Coming lights/)
    })

    it("still allows registering an opportunity with no reference yet", async () => {
      await expect(
        opportunityService.createOpportunity(
          {
            registration_date: "2026-08-18",
            lead_source: "LGU",
            client_name: "Fresh Lead",
            project_title: "Nothing quoted yet",
            items: [],
          },
          registrar.id,
        ),
      ).resolves.toBeTruthy()
    })

    it("lets an opportunity keep its own reference when edited", async () => {
      const opp = makeOpportunity({ registered_by: registrar.id, sales_reference: "S08200" })

      // Re-saving the same form must not read as a clash with itself.
      await expect(
        opportunityService.updateOpportunity(
          opp.id,
          {
            lead_source: "LGU",
            client_name: "Same Client",
            project_title: "Same Project",
            sales_reference: "S08200",
            items: [],
          },
          registrar.id,
        ),
      ).resolves.toBeTruthy()
    })

    it("refuses to move an opportunity onto a reference another deal holds", async () => {
      makeOpportunity({ registered_by: registrar.id, sales_reference: "S08300", client_name: "Holder Corp" })
      const other = makeOpportunity({ registered_by: registrar.id, sales_reference: "S08301" })

      await expect(
        opportunityService.updateOpportunity(
          other.id,
          {
            lead_source: "LGU",
            client_name: "Thief Corp",
            project_title: "Taking the ref",
            sales_reference: "S08300",
            items: [],
          },
          registrar.id,
        ),
      ).rejects.toThrow(/already registered to Holder Corp/)
    })

    it("refuses a duplicate reference supplied during a stage transition", async () => {
      makeOpportunity({ registered_by: registrar.id, sales_reference: "S08400", client_name: "Holder Corp" })
      const lead = makeOpportunity({ registered_by: registrar.id })

      await expect(
        opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id, null, "S08400"),
      ).rejects.toThrow(/already registered to Holder Corp/)
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
    it("notifies the person named in a note", async () => {
      const buyer = makeEmployee({ name: "Cjay Espina" })
      const opportunity = makeOpportunity({
        registered_by: registrar.id,
        sales_reference: "S01237",
      })

      const note = await opportunityService.addNote(
        opportunity.id,
        registrar.id,
        "@Cjay Espina can you check stock on this",
        [],
        [{ id: buyer.id, name: "Cjay Espina" }],
      )
      await waitForNetworkIdle()

      expect(note.metadata.mentions).toEqual([{ id: buyer.id, name: "Cjay Espina" }])
      const [sent] = db.rows("notifications")
      expect(sent).toMatchObject({
        recipient_id: buyer.id,
        // No "TASK" substring: notificationRouter's fallthrough would send them
        // to the task pages instead of the deal being discussed.
        type: "OPPORTUNITY_MENTION",
        reference_id: opportunity.id,
      })
    })

    it("does not notify someone whose name was deleted before posting", async () => {
      const buyer = makeEmployee({ name: "Cjay Espina" })
      const opportunity = makeOpportunity({ registered_by: registrar.id })

      // Picked from the list, then thought better of it and removed the name.
      const note = await opportunityService.addNote(
        opportunity.id,
        registrar.id,
        "never mind, sorted it",
        [],
        [{ id: buyer.id, name: "Cjay Espina" }],
      )
      await waitForNetworkIdle()

      expect(note.metadata).toBeNull()
      expect(db.rows("notifications")).toHaveLength(0)
    })

    it("does not notify the author for mentioning themselves", async () => {
      const opportunity = makeOpportunity({ registered_by: registrar.id })

      await opportunityService.addNote(
        opportunity.id,
        registrar.id,
        "@Ana Reyes to follow up on Monday",
        [],
        [{ id: registrar.id, name: "Ana Reyes" }],
      )
      await waitForNetworkIdle()

      // Writing your own name is a note to self, not a request to be pinged.
      expect(db.rows("notifications")).toHaveLength(0)
    })

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

  describe("project type auto-derivation", () => {
    it("derives CP on creation when supporting salespeople are present", async () => {
      const support = makeEmployee({ name: "Support One" })
      const created = await opportunityService.createOpportunity(
        payload({
          project_type: "SSP", // Client sent SSP, but supporting salesperson is present
          support_sales_1_id: support.id,
        }),
        registrar.id,
      )

      expect(created.project_type).toBe("CP")
    })

    it("derives SSP on creation when no supporting salespeople are present", async () => {
      const created = await opportunityService.createOpportunity(
        payload({
          project_type: "CP", // Client sent CP, but no supporting salespeople
          support_sales_1_id: null,
          support_sales_2_id: null,
        }),
        registrar.id,
      )

      expect(created.project_type).toBe("SSP")
    })

    it("preserves STRATEGIC project type on creation", async () => {
      const created = await opportunityService.createOpportunity(
        payload({
          project_type: "STRATEGIC",
        }),
        registrar.id,
      )

      expect(created.project_type).toBe("STRATEGIC")
    })

    it("re-derives CP on update when supporting salespeople are added", async () => {
      const created = await opportunityService.createOpportunity(payload(), registrar.id)
      expect(created.project_type).toBe("SSP")

      const support = makeEmployee({ name: "Support Person" })
      const updated = await opportunityService.updateOpportunity(
        created.id,
        {
          ...payload(),
          support_sales_1_id: support.id,
        },
        registrar.id,
      )

      expect(updated.project_type).toBe("CP")
    })

    it("re-derives SSP on update when supporting salespeople are cleared", async () => {
      const support = makeEmployee({ name: "Support Person" })
      const created = await opportunityService.createOpportunity(
        payload({ support_sales_1_id: support.id }),
        registrar.id,
      )
      expect(created.project_type).toBe("CP")

      const updated = await opportunityService.updateOpportunity(
        created.id,
        {
          ...payload(),
          support_sales_1_id: null,
          support_sales_2_id: null,
        },
        registrar.id,
      )

      expect(updated.project_type).toBe("SSP")
    })
  })
})

