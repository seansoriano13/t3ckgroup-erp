import { beforeEach, describe, expect, it } from "vitest"
import { opportunityService } from "./opportunityService"
import { db } from "@/test/db/store"
import {
  makeEmployee,
  makeOpportunity,
  makeRequirementStatus,
  makeStageRequirement,
  seedPipeline,
} from "@/test/factories"
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
    seedPipeline()
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

    it("refuses to reach For Bidding without an ITB Number on record", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      await expect(
        opportunityService.updateStatus(lead.id, "FOR_BIDDING", registrar.id),
      ).rejects.toThrow(/ITB Number/i)

      const unchanged = await opportunityService.getOpportunityById(lead.id)
      expect(unchanged.status).toBe("LEAD")
    })

    it("raises a clean error for a missing ITB Number without a round trip to the database", async () => {
      // Mirrors the Sales Reference gate: the service checks before writing,
      // rather than relying on the trigger's raw constraint-violation message
      // to reach the caller. Matters for anything that calls updateStatus
      // other than the details modal, which already gates client-side.
      //
      // A trigger-surfaced rejection carries `.pgrst` (see pgrstError in the
      // fake database); a plain `throw new Error(...)` from the service does
      // not. That is the only reliable way to tell "the service refused" from
      // "the database refused" apart, since the messages are deliberately the
      // same wording either way.
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      let caught = null
      try {
        await opportunityService.updateStatus(lead.id, "FOR_BIDDING", registrar.id)
      } catch (error) {
        caught = error
      }

      expect(caught?.message).toMatch(/ITB Number/i)
      expect(caught?.pgrst).toBeUndefined()
    })

    it("tells the caller an outright deal is the way past the gate", async () => {
      // The refusal has to name the second answer, or the only ways out a
      // salesperson can see are inventing a number or giving up — and one of
      // those two leaves fabricated ITB Numbers in the register.
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      await expect(
        opportunityService.updateStatus(lead.id, "FOR_BIDDING", registrar.id),
      ).rejects.toThrow(/outright/i)
    })

    it("advances an outright deal with no ITB Number when the move declares it", async () => {
      // Government direct contracts and the like: won with no Invitation to
      // Bid ever issued, so there is no number that could be supplied. This
      // is the move that was impossible between migrations 0035 and 0038.
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      const moved = await opportunityService.updateStatus(
        lead.id,
        "CLOSED_WON",
        registrar.id,
        null,
        null,
        null,
        true,
      )

      expect(moved.status).toBe("CLOSED_WON")
      expect(moved.itb_exempt).toBe(true)
      expect(moved.itb_number).toBeNull()
    })

    it("writes the outright claim to the log notes under the actor's name", async () => {
      // A silent boolean on the row would leave no answer to "why did this one
      // get through without a number", which is the question an audit asks.
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      await opportunityService.updateStatus(
        lead.id,
        "CLOSED_WON",
        registrar.id,
        null,
        null,
        null,
        true,
      )

      const notes = await opportunityService.getNotes(lead.id)
      const claim = notes.find((n) => n.metadata?.event === "ITB_EXEMPT_DECLARED")

      expect(claim).toBeTruthy()
      expect(claim.content).toMatch(/outright/i)
      expect(claim.author_id).toBe(registrar.id)
      // The move itself is still recorded separately — the claim explains the
      // move, it does not replace it.
      expect(notes.some((n) => n.metadata?.event === "STAGE_CHANGED")).toBe(true)
    })

    it("does not re-log the outright claim on a later move", async () => {
      // Already declared. Repeating the note on every subsequent stage change
      // would bury the timeline in a claim nobody made twice.
      const lead = makeOpportunity({
        registered_by: registrar.id,
        sales_reference: "S00999",
        status: "FOR_BIDDING",
        itb_exempt: true,
      })

      await opportunityService.updateStatus(lead.id, "AWARDED", registrar.id, null, null, null, true)

      const notes = await opportunityService.getNotes(lead.id)
      const claims = notes.filter((n) => n.metadata?.event === "ITB_EXEMPT_DECLARED")
      expect(claims).toHaveLength(0)
    })

    it("keeps letting an already-outright deal advance without re-declaring", async () => {
      const lead = makeOpportunity({
        registered_by: registrar.id,
        sales_reference: "S00999",
        itb_exempt: true,
      })

      const moved = await opportunityService.updateStatus(lead.id, "CLOSED_WON", registrar.id)

      expect(moved.status).toBe("CLOSED_WON")
    })

    it("advances to For Bidding when the ITB Number is supplied with the move", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      const moved = await opportunityService.updateStatus(
        lead.id,
        "FOR_BIDDING",
        registrar.id,
        null,
        null,
        "ITB-2026-001",
      )

      expect(moved.status).toBe("FOR_BIDDING")
      expect(moved.itb_number).toBe("ITB-2026-001")
    })

    it("does not re-ask for an ITB Number moving between stages already past the gate", async () => {
      const lead = makeOpportunity({
        registered_by: registrar.id,
        sales_reference: "S00999",
        status: "FOR_BIDDING",
        itb_number: "ITB-2026-001",
      })

      const moved = await opportunityService.updateStatus(lead.id, "BID_SUBMITTED", registrar.id)

      expect(moved.status).toBe("BID_SUBMITTED")
    })

    it("lets a lead be closed as lost before it was ever put out to bid", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      const moved = await opportunityService.updateStatus(lead.id, "CLOSED_LOST", registrar.id, "Cancelled")

      expect(moved.status).toBe("CLOSED_LOST")
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

      const awarded = await opportunityService.updateStatus(
        lead.id,
        "AWARDED",
        registrar.id,
        null,
        null,
        "ITB-2026-001",
      )

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

    it("keeps the original Contract Date if the opportunity leaves and re-enters Awarded", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })
      const firstAward = await opportunityService.updateStatus(
        lead.id,
        "AWARDED",
        registrar.id,
        null,
        null,
        "ITB-2026-001",
      )
      const firstDate = firstAward.contract_date

      await opportunityService.updateStatus(lead.id, "NEGOTIATION", registrar.id)
      const reAwarded = await opportunityService.updateStatus(lead.id, "AWARDED", registrar.id)

      expect(reAwarded.contract_date).toBe(firstDate)
    })
  })

  describe("the stage gate engine", () => {
    // Real pipeline order below FOR_BIDDING (35, the ITB gate): LEAD (10) →
    // PROPOSAL_SUBMITTED (20) → QUALIFIED (30). Leaving Lead always needs a
    // Sales Reference (unrelated gate), so every fixture below supplies one.

    it("refuses a move that leaves a required requirement unsatisfied, naming it, and writes nothing", async () => {
      // On Lead itself — the origin, not the destination — so leaving it is
      // what's being asked about, not arriving at Proposal Submitted.
      makeStageRequirement({
        stage_code: "LEAD",
        kind: "field",
        label: "Contact person on file",
        config: { column: "contact_person" },
      })
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      await expect(
        opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id),
      ).rejects.toThrow(/Contact person on file/)

      const unchanged = await opportunityService.getOpportunityById(lead.id)
      expect(unchanged.status).toBe("LEAD")
      expect(await opportunityService.getNotes(lead.id)).toHaveLength(0)
    })

    it("blocks on a requirement at a stage skipped over, not just the destination", async () => {
      makeStageRequirement({
        stage_code: "PROPOSAL_SUBMITTED",
        kind: "field",
        label: "Contact person on file",
        config: { column: "contact_person" },
      })
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      // Jumps straight past Proposal Submitted to Qualified — the destination
      // itself carries no requirement, but the stage it skipped does.
      await expect(
        opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id),
      ).rejects.toThrow(/Contact person on file/)
    })

    it("unblocks once the last outstanding requirement is satisfied", async () => {
      makeStageRequirement({
        stage_code: "LEAD",
        kind: "field",
        label: "Contact person on file",
        config: { column: "contact_person" },
      })
      const lead = makeOpportunity({
        registered_by: registrar.id,
        sales_reference: "S00999",
        contact_person: "Juan Dela Cruz",
      })

      const moved = await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id)

      expect(moved.status).toBe("PROPOSAL_SUBMITTED")
    })

    it("does not re-ask a requirement already satisfied, on re-entering its stage", async () => {
      const requirement = makeStageRequirement({
        stage_code: "LEAD",
        kind: "tickbox",
        label: "Bid documents checked",
      })
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      await expect(
        opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id),
      ).rejects.toThrow(/Bid documents checked/)

      makeRequirementStatus({ opportunity_id: lead.id, requirement_id: requirement.id, satisfied_by: owner.id })
      const moved = await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id)
      expect(moved.status).toBe("PROPOSAL_SUBMITTED")

      // Backward move crosses nothing, so re-entering doesn't re-derive the
      // answer — the same status row is still what satisfies it.
      await opportunityService.updateStatus(lead.id, "LEAD", registrar.id)
      const reentered = await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id)
      expect(reentered.status).toBe("PROPOSAL_SUBMITTED")
    })

    it("does not block a future move on a requirement added to a stage already left behind", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })
      await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id)
      await opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id)

      // Added after the deal already left Proposal Submitted behind.
      makeStageRequirement({
        stage_code: "PROPOSAL_SUBMITTED",
        kind: "field",
        label: "Contact person on file",
        config: { column: "contact_person" },
      })

      const moved = await opportunityService.updateStatus(
        lead.id,
        "FOR_BIDDING",
        registrar.id,
        null,
        null,
        "ITB-2026-001",
      )
      expect(moved.status).toBe("FOR_BIDDING")
    })

    it("does not block on an archived requirement, and its prior satisfaction survives the archiving", async () => {
      const requirement = makeStageRequirement({
        stage_code: "LEAD",
        kind: "tickbox",
        label: "Bid documents checked",
      })
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })
      const status = makeRequirementStatus({
        opportunity_id: lead.id,
        requirement_id: requirement.id,
        satisfied_by: owner.id,
      })

      // Archiving is ticket 3's own action — simulated directly here, since
      // ticket 2 only reads stage_requirements, never writes archived_at.
      requirement.archived_at = "2026-01-01T00:00:00.000Z"
      db.internal.rowsOf("stage_requirements").find((r) => r.id === requirement.id).archived_at =
        requirement.archived_at

      const moved = await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id)

      expect(moved.status).toBe("PROPOSAL_SUBMITTED")
      expect(db.internal.rowsOf("sor_requirement_status").find((r) => r.id === status.id)).toBeTruthy()
    })

    it("evaluates a field requirement against the value this same move is about to set, not the one it's replacing", async () => {
      makeStageRequirement({
        stage_code: "LEAD",
        kind: "field",
        label: "Sales Reference on file",
        config: { column: "sales_reference" },
      })
      // No Sales Reference on record — supplied with the move itself, the
      // same way requiresSalesReference and requiresItbNumber already treat
      // an incoming value as satisfying their own gate on the same call.
      const lead = makeOpportunity({ registered_by: registrar.id })

      const moved = await opportunityService.updateStatus(
        lead.id,
        "PROPOSAL_SUBMITTED",
        registrar.id,
        null,
        "S01237",
      )

      expect(moved.status).toBe("PROPOSAL_SUBMITTED")
    })

    it("coexists with the ITB gate — either can block the same move, independently", async () => {
      // On Qualified — crossed on the way to For Bidding, so it's still in
      // play the first time this deal tries to reach the gate stage.
      makeStageRequirement({
        stage_code: "QUALIFIED",
        kind: "field",
        label: "Contact person on file",
        config: { column: "contact_person" },
      })
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      // The ITB gate blocks first — the engine's own check is never reached.
      await expect(
        opportunityService.updateStatus(lead.id, "FOR_BIDDING", registrar.id),
      ).rejects.toThrow(/ITB Number/i)

      // Satisfying the ITB gate surfaces the engine's block underneath it.
      await expect(
        opportunityService.updateStatus(lead.id, "FOR_BIDDING", registrar.id, null, null, "ITB-2026-001"),
      ).rejects.toThrow(/Contact person on file/)

      const unchanged = await opportunityService.getOpportunityById(lead.id)
      expect(unchanged.status).toBe("LEAD")
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

      await opportunityService.updateStatus(
        lead.id,
        "AWARDED",
        registrar.id,
        null,
        null,
        "ITB-2026-001",
      )
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

