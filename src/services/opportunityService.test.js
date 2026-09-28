import { beforeEach, describe, expect, it, vi } from "vitest"
import { opportunityService } from "./opportunityService"
import { notificationService } from "./notificationService"
import { db } from "@/test/db/store"
import {
  makeEmployee,
  makeFlowEdge,
  makeFlowSnapshot,
  makeFlowStage,
  makeOpportunity,
  makeOpportunityItem,
  makeConditionStatus,
  makeEmployeeGroup,
  makeFollowUpCadence,
  makeGroupTask,
  makeOpportunityMember,
  makeSaleType,
  makeSalesFlow,
  makeStageAction,
  makeStageCondition,
  makeStageField,
  makeStageParticipant,
  makeStageVisit,
  makeSuperAdmin,
  makeTask,
  seedPipeline,
} from "@/test/factories"
import { employeeGroupService } from "./employeeGroupService"
import { waitForNetworkIdle } from "@/test/network"
import { stubEdgeFunction, stubRpc } from "@/test/msw/server"
import { stubActionRunRpcs } from "@/test/stubs/actionRunRpc"

/**
 * Sales Opportunity Registration, exercised end to end through the service's
 * public methods against the fake PostgREST. Registration order settles
 * commission disputes and stage moves are the audit trail, so what is asserted
 * here is what the next person reads out of the system, not how the service
 * got there.
 */
// A loop back is a Return (#390): those tests take the Resume path.
const RESUME = { returnChoice: "resume" }

describe("opportunityService", () => {
  let registrar
  let owner

  beforeEach(() => {
    seedPipeline()
    stubActionRunRpcs()
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

    // Issue #179 — `serial_no` (the SOR Register's first column and default
    // sort) existed in production but was never created by a migration, so
    // staging never had it. Reconciled by
    // 20260909140000_reconcile_sor_register_serial_no.sql; this is the
    // assertion that the drift closed, run against the fake database that
    // schema.js builds straight from the migrations.
    it("assigns a serial number on registration, distinct per opportunity", async () => {
      const first = await opportunityService.createOpportunity(payload(), registrar.id)
      const second = await opportunityService.createOpportunity(
        payload({ client_name: "Manila Water District" }),
        registrar.id,
      )

      expect(Number(first.serial_no)).toBeGreaterThan(0)
      expect(Number(second.serial_no)).toBeGreaterThan(Number(first.serial_no))
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

    // Issue #36 — a Scratch SOR runs identical code paths to a real deal, so
    // it is indistinguishable to any query that does not ask. The Register is
    // the read every count, board and matrix starts from; it asks.
    it("hides Scratch SORs from the register", async () => {
      const real = makeOpportunity({ registered_by: registrar.id, client_name: "Real" })
      makeOpportunity({ registered_by: registrar.id, client_name: "Scratch", is_scratch: true })

      const list = await opportunityService.getOpportunities()

      expect(list.map((o) => o.id)).toEqual([real.id])
    })

    it("still opens a Scratch SOR by id, so the canvas can watch it", async () => {
      const scratch = makeOpportunity({ registered_by: registrar.id, is_scratch: true })

      const found = await opportunityService.getOpportunityById(scratch.id)

      expect(found.id).toBe(scratch.id)
      expect(found.is_scratch).toBe(true)
    })

    // The Release Notes deck opens the demo SOR scripts/seed-release-demo.mjs
    // made last: a Scratch SOR, so the register never shows it.
    it("finds the newest Release Notes demo SOR, and nothing else", async () => {
      makeOpportunity({ registered_by: registrar.id, is_scratch: true, metadata: { releaseDemo: true }, created_at: "2026-09-27T00:00:00Z" })
      const newest = makeOpportunity({ registered_by: registrar.id, is_scratch: true, metadata: { releaseDemo: true }, created_at: "2026-09-28T00:00:00Z" })
      makeOpportunity({ registered_by: registrar.id, is_scratch: true, metadata: {}, created_at: "2026-09-29T00:00:00Z" })

      const found = await opportunityService.getReleaseDemoSor()

      expect(found.id).toBe(newest.id)
    })

    it("returns null when no demo SOR has been seeded", async () => {
      makeOpportunity({ registered_by: registrar.id })

      expect(await opportunityService.getReleaseDemoSor()).toBeNull()
    })

    // Issue #170/#171 — same mechanism as Scratch: a retail order runs
    // identical code paths to a real deal, so the Register must ask.
    it("hides Retail SORs from the register", async () => {
      const real = makeOpportunity({ registered_by: registrar.id, client_name: "Real" })
      makeOpportunity({ registered_by: registrar.id, client_name: "Retail", is_retail: true })

      const list = await opportunityService.getOpportunities()

      expect(list.map((o) => o.id)).toEqual([real.id])
    })

    it("still opens a Retail SOR by id, so the Retail tab can show it", async () => {
      const retail = makeOpportunity({ registered_by: registrar.id, is_retail: true })

      const found = await opportunityService.getOpportunityById(retail.id)

      expect(found.id).toBe(retail.id)
      expect(found.is_retail).toBe(true)
    })
  })

  // Issue #174 — the Retail tab: same table as the register, flag inverted.
  describe("getRetailOpportunities", () => {
    it("returns only Retail SORs, not the ordinary register", async () => {
      const real = makeOpportunity({ registered_by: registrar.id, client_name: "Real" })
      const retail = makeOpportunity({
        registered_by: registrar.id,
        client_name: "Shopee T3ck Outdoor",
        is_retail: true,
      })

      const list = await opportunityService.getRetailOpportunities()

      expect(list.map((o) => o.id)).toEqual([retail.id])
      expect(list.map((o) => o.id)).not.toContain(real.id)
    })

    it("excludes a soft-deleted retail record", async () => {
      const retail = makeOpportunity({ registered_by: registrar.id, is_retail: true })
      await opportunityService.deleteOpportunity(retail.id, registrar.id)

      const list = await opportunityService.getRetailOpportunities()

      expect(list).toHaveLength(0)
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

      const moved = await opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id, { salesReference: "S01237" })

      expect(moved.status).toBe("QUALIFIED")
      expect(moved.sales_reference).toBe("S01237")
    })

    it("advances when a sales reference is already on record", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      const moved = await opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id)

      expect(moved.status).toBe("QUALIFIED")
    })

    // The ITB gate at For Bidding was removed (issue #206, ADR 0004 D12) —
    // Sales Flows replaced it. These replace the old gate tests to assert it
    // no longer blocks, while the Sales Reference rule keeps working.
    it("reaches For Bidding and beyond with no ITB Number on record", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      const moved = await opportunityService.updateStatus(lead.id, "FOR_BIDDING", registrar.id)

      expect(moved.status).toBe("FOR_BIDDING")
      expect(moved.itb_number).toBeNull()
      expect(moved.itb_exempt).toBe(false)
    })

    it("no longer writes itb_number/itb_exempt from a stage move", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      const moved = await opportunityService.updateStatus(lead.id, "CLOSED_WON", registrar.id)

      expect(moved.status).toBe("CLOSED_WON")
      expect(moved.itb_number).toBeNull()
      expect(moved.itb_exempt).toBe(false)
    })

    it("keeps an existing ITB Number untouched across further moves", async () => {
      const lead = makeOpportunity({
        registered_by: registrar.id,
        sales_reference: "S00999",
        status: "FOR_BIDDING",
        itb_number: "ITB-2026-001",
      })

      const moved = await opportunityService.updateStatus(lead.id, "BID_SUBMITTED", registrar.id)

      expect(moved.status).toBe("BID_SUBMITTED")
      expect(moved.itb_number).toBe("ITB-2026-001")
    })

    it("lets a lead be closed as lost before it was ever put out to bid", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      const moved = await opportunityService.updateStatus(lead.id, "CLOSED_LOST", registrar.id, { lostReason: "Cancelled" })

      expect(moved.status).toBe("CLOSED_LOST")
    })

    it("lets a lead be closed as lost before it was ever quoted", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id })

      const moved = await opportunityService.updateStatus(lead.id, "CLOSED_LOST", registrar.id, { lostReason: "Client cancelled the procurement" })

      expect(moved.status).toBe("CLOSED_LOST")
      expect(moved.lost_reason).toBe("Client cancelled the procurement")
    })

    it("clears the lost reason when a closed-lost deal is revived", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })
      await opportunityService.updateStatus(lead.id, "CLOSED_LOST", registrar.id, { lostReason: "Budget cut" })

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

      await opportunityService.updateStatus(lead.id, "CLOSED_LOST", registrar.id, { lostReason: "Lost on price" })

      const notes = await opportunityService.getNotes(lead.id)
      expect(notes.at(-1).content).toBe("Stage moved: Lead → Closed Lost — Lost on price")
    })

    it("records the sales reference separately from the stage move", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id })

      await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id, { salesReference: "S01237" })

      const notes = await opportunityService.getNotes(lead.id)
      expect(notes.map((n) => n.content)).toEqual([
        "Sales Reference recorded: S01237",
        "Stage moved: Lead → Proposal Submitted",
      ])
    })

    it("does not re-record a sales reference that is already the one on file", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S01237" })

      await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id, { salesReference: "S01237" })

      const notes = await opportunityService.getNotes(lead.id)
      expect(notes.map((n) => n.content)).toEqual(["Stage moved: Lead → Proposal Submitted"])
    })

    it("rejects a malformed sales reference before touching the record", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id })

      await expect(
        opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id, { salesReference: "12345" }),
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

      const moved = await opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id, { salesReference: "S01237" })

      expect(moved.contract_date).toBeFalsy()
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

  describe.skip("the stage gate engine", () => {
    // Real pipeline order below FOR_BIDDING (35, the ITB gate): LEAD (10) →
    // PROPOSAL_SUBMITTED (20) → QUALIFIED (30). Leaving Lead always needs a
    // Sales Reference (unrelated gate), so every fixture below supplies one.

    it("refuses a move that leaves a required condition unsatisfied, naming it, and writes nothing", async () => {
      // On Lead itself — the origin, not the destination — so leaving it is
      // what's being asked about, not arriving at Proposal Submitted.
      makeStageCondition({
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

    it("blocks on a condition at a stage skipped over, not just the destination", async () => {
      makeStageCondition({
        stage_code: "PROPOSAL_SUBMITTED",
        kind: "field",
        label: "Contact person on file",
        config: { column: "contact_person" },
      })
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      // Jumps straight past Proposal Submitted to Qualified — the destination
      // itself carries no condition, but the stage it skipped does.
      await expect(
        opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id),
      ).rejects.toThrow(/Contact person on file/)
    })

    it("unblocks once the last outstanding condition is satisfied", async () => {
      makeStageCondition({
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

    it("does not re-ask a condition already satisfied, on re-entering its stage", async () => {
      const condition = makeStageCondition({
        stage_code: "LEAD",
        kind: "tickbox",
        label: "Bid documents checked",
      })
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })

      await expect(
        opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id),
      ).rejects.toThrow(/Bid documents checked/)

      makeConditionStatus({ opportunity_id: lead.id, condition_id: condition.id, satisfied_by: owner.id })
      const moved = await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id)
      expect(moved.status).toBe("PROPOSAL_SUBMITTED")

      // Backward move crosses nothing, so re-entering doesn't re-derive the
      // answer — the same status row is still what satisfies it.
      await opportunityService.updateStatus(lead.id, "LEAD", registrar.id)
      const reentered = await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id)
      expect(reentered.status).toBe("PROPOSAL_SUBMITTED")
    })

    it("does not block a future move on a condition added to a stage already left behind", async () => {
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })
      await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id)
      await opportunityService.updateStatus(lead.id, "QUALIFIED", registrar.id)

      // Added after the deal already left Proposal Submitted behind.
      makeStageCondition({
        stage_code: "PROPOSAL_SUBMITTED",
        kind: "field",
        label: "Contact person on file",
        config: { column: "contact_person" },
      })

      const moved = await opportunityService.updateStatus(lead.id, "FOR_BIDDING", registrar.id)
      expect(moved.status).toBe("FOR_BIDDING")
    })

    it("does not block on an archived condition, and its prior satisfaction survives the archiving", async () => {
      const condition = makeStageCondition({
        stage_code: "LEAD",
        kind: "tickbox",
        label: "Bid documents checked",
      })
      const lead = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999" })
      const status = makeConditionStatus({
        opportunity_id: lead.id,
        condition_id: condition.id,
        satisfied_by: owner.id,
      })

      // Archiving is ticket 3's own action — simulated directly here, since
      // ticket 2 only reads stage_conditions, never writes archived_at.
      condition.archived_at = "2026-01-01T00:00:00.000Z"
      db.internal.rowsOf("stage_conditions").find((r) => r.id === condition.id).archived_at =
        condition.archived_at

      const moved = await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id)

      expect(moved.status).toBe("PROPOSAL_SUBMITTED")
      expect(db.internal.rowsOf("sor_condition_status").find((r) => r.id === status.id)).toBeTruthy()
    })

    it("evaluates a field condition against the value this same move is about to set, not the one it's replacing", async () => {
      makeStageCondition({
        stage_code: "LEAD",
        kind: "field",
        label: "Sales Reference on file",
        config: { column: "sales_reference" },
      })
      // No Sales Reference on record — supplied with the move itself, the
      // same way requiresSalesReference and requiresItbNumber already treat
      // an incoming value as satisfying their own gate on the same call.
      const lead = makeOpportunity({ registered_by: registrar.id })

      const moved = await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id, { salesReference: "S01237" })

      expect(moved.status).toBe("PROPOSAL_SUBMITTED")
    })

  })

  describe("per-kind satisfaction (ticket 5)", () => {
    let saleType, flow, lead, qualified
    beforeEach(() => {
      saleType = makeSaleType({ name: "Flow" })
      flow = makeSalesFlow({ sale_type_id: saleType.id })
      lead = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
      qualified = makeFlowStage({ flow_id: flow.id, name: "Qualified", sort_order: 1 })
      makeFlowEdge(lead, qualified)
    })

    const flowPayload = (overrides = {}) => payload({ sale_type_id: saleType.id, ...overrides })
    // Issue #203: field is a removed kind — it evaluates not_applicable
    // regardless of the record, so saving the column it used to watch never
    // narrates a satisfaction any more.
    it("never narrates a field condition — it's a removed kind", async () => {
      makeStageCondition({
        stage_id: lead.id,
        kind: "field",
        label: "PO Date on file",
        config: { column: "po_date" },
      })
      makeFlowSnapshot({ flow_id: flow.id })
      const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

      await opportunityService.updateOpportunity(
        created.id,
        payload({ po_date: "2026-04-01" }),
        registrar.id,
      )

      const notes = await opportunityService.getNotes(created.id)
      expect(notes.some((n) => n.content.includes("Condition satisfied"))).toBe(false)
    })

    it("does not narrate a save that leaves the field condition unsatisfied", async () => {
      makeStageCondition({
        stage_id: lead.id,
        kind: "field",
        label: "PO Date on file",
        config: { column: "po_date" },
      })
      makeFlowSnapshot({ flow_id: flow.id })
      const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

      await opportunityService.updateOpportunity(
        created.id,
        payload({ contact_person: "Engr. Santos" }),
        registrar.id,
      )

      const notes = await opportunityService.getNotes(created.id)
      expect(notes.some((n) => n.content.includes("Condition satisfied"))).toBe(false)
    })

    it("does not narrate again once a field condition is already satisfied", async () => {
      makeStageCondition({
        stage_id: lead.id,
        kind: "field",
        label: "PO Date on file",
        config: { column: "po_date" },
      })
      makeFlowSnapshot({ flow_id: flow.id })
      const created = await opportunityService.createOpportunity(
        flowPayload({ po_date: "2026-04-01" }),
        registrar.id,
      )

      await opportunityService.updateOpportunity(
        created.id,
        payload({ po_date: "2026-04-02" }),
        registrar.id,
      )

      const notes = await opportunityService.getNotes(created.id)
      expect(notes.filter((n) => n.content.includes("Condition satisfied"))).toHaveLength(0)
    })

    it("narrates an attachment condition the moment the upload that satisfies it lands", async () => {
      makeStageCondition({
        stage_id: lead.id,
        kind: "attachment",
        label: "Notice of Award",
        config: { documentType: "NOA" },
      })
      makeFlowSnapshot({ flow_id: flow.id })
      const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

      await opportunityService.addNote(created.id, registrar.id, "", [
        { url: "https://cdn.test/noa.pdf", name: "noa.pdf", documentType: "NOA" },
      ])

      const notes = await opportunityService.getNotes(created.id)
      expect(notes.some((n) => n.content === 'Condition satisfied: "Notice of Award".')).toBe(true)
    })

    it("does not satisfy an attachment condition with a file of the wrong document type", async () => {
      makeStageCondition({
        stage_id: lead.id,
        kind: "attachment",
        label: "Notice of Award",
        config: { documentType: "NOA" },
      })
      makeFlowSnapshot({ flow_id: flow.id })
      const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

      await opportunityService.addNote(created.id, registrar.id, "", [
        { url: "https://cdn.test/quote.pdf", name: "quote.pdf", documentType: "QUOTE" },
      ])

      const notes = await opportunityService.getNotes(created.id)
      expect(notes.some((n) => n.content.includes("Condition satisfied"))).toBe(false)
    })

    describe("Return: Resume previous work (#390)", () => {
      const dealOnLead = () => {
        makeFlowEdge(qualified, lead)
        const snapshot = makeFlowSnapshot({ flow_id: flow.id })
        return makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999", sale_type_id: saleType.id, flow_stage_id: lead.id, flow_snapshot_id: snapshot.id })
      }

      it("asks nothing for a Stage the SOR has never visited", async () => {
        const deal = dealOnLead()
        const moved = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        expect(moved.flow_stage_id).toBe(qualified.id)
      })

      it("refuses a Return made without a choice, naming what is needed", async () => {
        const deal = dealOnLead()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        const attempt = opportunityService.updateStatus(deal.id, lead.id, registrar.id)
        await expect(attempt).rejects.toThrow(/Resume previous work or Start fresh/)
        await expect(attempt).rejects.toMatchObject({ needsReturnChoice: true })
      })

      it("Resume moves the earlier visit's work to the new visit, and records the choice on the timeline", async () => {
        const deal = dealOnLead()
        const firstVisit = db.internal.rowsOf("sor_stage_visits").find((v) => v.opportunity_id === deal.id)
        db.internal.rowsOf("sor_stage_field_values").push({ id: "fv1", opportunity_id: deal.id, stage_visit_id: firstVisit.id, field_id: "f", value: "kept" })
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const moved = await opportunityService.updateStatus(deal.id, lead.id, registrar.id, RESUME)
        expect(moved.flow_stage_id).toBe(lead.id)

        const visits = db.internal.rowsOf("sor_stage_visits").filter((v) => v.opportunity_id === deal.id)
        const current = visits.find((v) => v.left_at == null)
        expect(current.return_choice).toBe("resume")
        expect(db.internal.rowsOf("sor_stage_field_values").find((f) => f.id === "fv1").stage_visit_id).toBe(current.id)
        const notes = db.internal.rowsOf("sales_opportunity_logs").filter((l) => l.opportunity_id === deal.id && l.metadata?.event === "STAGE_CHANGED")
        expect(notes.at(-1).metadata.returnChoice).toBe("resume")
      })

      it("does not block a Return on the conditions of the Stage being left", async () => {
        const deal = dealOnLead()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        makeStageCondition({ stage_id: qualified.id, kind: "tickbox", label: "Sign-off", config: {} })
        const moved = await opportunityService.updateStatus(deal.id, lead.id, registrar.id, RESUME)
        expect(moved.flow_stage_id).toBe(lead.id)
      })
    })

    describe("Return: Start fresh (#391)", () => {
      // Registered → Lead (fires the Stage's action) → Qualified → Return to
      // Lead, so the earlier Lead visit was entered through a real move (and
      // has a real action run to close off), not the raw seed row.
      const dealOnRegistered = () => {
        const registered = makeFlowStage({ flow_id: flow.id, name: "Registered", sort_order: -1 })
        makeFlowEdge(registered, lead)
        makeFlowEdge(qualified, lead)
        makeStageAction({ stage_id: lead.id, kind: "create_individual_task", config: { title: "Say hello" } })
        const snapshot = makeFlowSnapshot({ flow_id: flow.id })
        return makeOpportunity({
          registered_by: registrar.id, sales_reference: "S00997", sale_type_id: saleType.id,
          flow_stage_id: registered.id, flow_snapshot_id: snapshot.id,
        })
      }

      it("cancels the earlier visit's live task, closes off its action run, and fires the Stage's action again for the new visit", async () => {
        const deal = dealOnRegistered()
        await opportunityService.updateStatus(deal.id, lead.id, registrar.id)

        const firstTask = db.internal.rowsOf("tasks").find((t) => t.opportunity_id === deal.id)
        expect(firstTask).toBeTruthy()
        const firstRun = db.internal.rowsOf("sor_action_runs").find((r) => r.opportunity_id === deal.id)
        expect(firstRun.outcome).toBe("created")

        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        const moved = await opportunityService.updateStatus(deal.id, lead.id, registrar.id, { returnChoice: "start_fresh" })
        expect(moved.flow_stage_id).toBe(lead.id)

        const visits = db.internal.rowsOf("sor_stage_visits").filter((v) => v.opportunity_id === deal.id)
        const current = visits.find((v) => v.left_at == null)
        expect(current.return_choice).toBe("start_fresh")

        const cancelledTask = db.internal.rowsOf("tasks").find((t) => t.id === firstTask.id)
        expect(cancelledTask.status).toBe("DELETED")
        expect(cancelledTask.cancel_reason).toBe("Superseded by a fresh start.")

        const closedRun = db.internal.rowsOf("sor_action_runs").find((r) => r.id === firstRun.id)
        expect(closedRun.closed_off_at).toBeTruthy()

        const newRun = db.internal.rowsOf("sor_action_runs").find((r) => r.opportunity_id === deal.id && r.id !== firstRun.id)
        expect(newRun).toBeTruthy()
        expect(newRun.outcome).toBe("created")
        expect(newRun.stage_visit_id).toBe(current.id)
        expect(db.internal.rowsOf("tasks").find((t) => t.id === newRun.task_id)?.stage_visit_id).toBe(current.id)

        const notes = db.internal.rowsOf("sales_opportunity_logs").filter((l) => l.opportunity_id === deal.id && l.metadata?.event === "STAGE_CHANGED")
        expect(notes.at(-1).metadata.returnChoice).toBe("start_fresh")
      })

      it("leaves ticks, files and field values on the earlier visit — nothing moves", async () => {
        const deal = dealOnRegistered()
        await opportunityService.updateStatus(deal.id, lead.id, registrar.id)
        const firstVisit = db.internal.rowsOf("sor_stage_visits").find((v) => v.opportunity_id === deal.id && v.flow_stage_id === lead.id)
        db.internal.rowsOf("sor_stage_field_values").push({ id: "fv-sf", opportunity_id: deal.id, stage_visit_id: firstVisit.id, field_id: "f", value: "kept" })

        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        await opportunityService.updateStatus(deal.id, lead.id, registrar.id, { returnChoice: "start_fresh" })

        expect(db.internal.rowsOf("sor_stage_field_values").find((f) => f.id === "fv-sf").stage_visit_id).toBe(firstVisit.id)
      })
    })

    describe("assignment / SOR Members", () => {
      it("blocks a move until someone from the named department is a member, then unblocks", async () => {
        makeStageCondition({
        stage_id: lead.id,
          kind: "assignment",
          label: "Purchasing officer assigned",
          config: { department: "Purchasing" },
        })
        const snapshot = makeFlowSnapshot({ flow_id: flow.id })
        const deal = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999", sale_type_id: saleType.id, flow_stage_id: lead.id, flow_snapshot_id: snapshot.id })

        await expect(
          opportunityService.updateStatus(deal.id, qualified.id, registrar.id),
        ).rejects.toThrow(/Purchasing officer assigned/)

        const buyer = makeEmployee({
          name: "Rey Santos",
          department: "OPERATIONS",
          sub_department: "Purchasing",
        })
        await opportunityService.addMember(deal.id, buyer.id, registrar.id)

        const moved = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        expect(moved.flow_stage_id).toBe(qualified.id)
      })

      it("matches a department-level config against a member's department, not just their sub-department", async () => {
        makeStageCondition({
        stage_id: lead.id,
          kind: "assignment",
          label: "Someone from Operations",
          config: { department: "OPERATIONS" },
        })
        const snapshot = makeFlowSnapshot({ flow_id: flow.id })
        const deal = makeOpportunity({ registered_by: registrar.id, sales_reference: "S00999", sale_type_id: saleType.id, flow_stage_id: lead.id, flow_snapshot_id: snapshot.id })
        const buyer = makeEmployee({ department: "OPERATIONS", sub_department: "Purchasing" })
        await opportunityService.addMember(deal.id, buyer.id, registrar.id)

        const moved = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        expect(moved.flow_stage_id).toBe(qualified.id)
      })

      it("narrates who was added and, when it satisfies a condition, that too", async () => {
        makeStageCondition({
        stage_id: lead.id,
          kind: "assignment",
          label: "Purchasing officer assigned",
          config: { department: "Purchasing" },
        })
        makeFlowSnapshot({ flow_id: flow.id })
      const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)
        const buyer = makeEmployee({ name: "Rey Santos", department: "Purchasing" })

        await opportunityService.addMember(created.id, buyer.id, registrar.id)

        const notes = (await opportunityService.getNotes(created.id)).map((n) => n.content)
        expect(notes).toContain("Rey Santos added as a member of this deal.")
        expect(notes).toContain('Condition satisfied: "Purchasing officer assigned".')
      })

      it("adding the same member twice is a no-op — no duplicate row, no duplicate note", async () => {
        makeFlowSnapshot({ flow_id: flow.id })
      const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)
        const buyer = makeEmployee({ name: "Rey Santos" })

        await opportunityService.addMember(created.id, buyer.id, registrar.id)
        await opportunityService.addMember(created.id, buyer.id, registrar.id)

        const members = await opportunityService.getMembers(created.id)
        expect(members).toHaveLength(1)

        const addedNotes = (await opportunityService.getNotes(created.id)).filter((n) =>
          n.content.includes("added as a member"),
        )
        expect(addedNotes).toHaveLength(1)
      })

      // Issue #294: a day-one Assignment call-in — the registration form
      // fills this the same way a checklist row's "Assign" button does.
      it("opens a Stage Participant window for a day-one Assignment condition made at registration", async () => {
        const condition = makeStageCondition({
          stage_id: lead.id,
          kind: "assignment",
          label: "Buyer assigned",
          config: { who: [], access: { until: "stage_left" } },
        })
        const buyer = makeEmployee({ name: "Rey Santos" })
        makeFlowSnapshot({ flow_id: flow.id })

        const created = await opportunityService.createOpportunity(
          flowPayload({ dayOneAssignments: { [condition.id]: buyer.id } }),
          registrar.id,
        )

        const members = await opportunityService.getMembers(created.id)
        expect(members.map((m) => m.employee_id)).toContain(buyer.id)

        const openVisit = db
          .rows("sor_stage_visits")
          .find((v) => v.opportunity_id === created.id && v.left_at == null)
        const participant = db
          .rows("sor_stage_participants")
          .find((p) => p.opportunity_id === created.id && p.employee_id === buyer.id)
        expect(participant).toBeTruthy()
        expect(participant.source).toBe("assignment")
        expect(participant.source_id).toBe(condition.id)
        expect(participant.opened_visit_id).toBe(openVisit.id)
        expect(participant.closed_at).toBeNull()
      })

      // Code review of #203 (0eceec9): a "who" selector of kind "group" or
      // "team" could never be satisfied because the members evaluateCondition
      // saw carried no groupIds/teamId at all — only employeeId/department.
      it("is satisfied by a group selector when a deal-team member belongs to that group", async () => {
        const admin = makeSuperAdmin()
        const buyer = makeEmployee({ name: "Rey Santos" })
        const group = await employeeGroupService.create(
          { name: "Purchasing Group", employeeIds: [buyer.id] },
          admin.id,
        )
        makeStageCondition({
          stage_id: lead.id,
          kind: "assignment",
          label: "Someone from the Purchasing Group",
          config: { who: [{ type: "group", id: group.id }] },
        })
        const snapshot = makeFlowSnapshot({ flow_id: flow.id })
        const deal = makeOpportunity({
          registered_by: registrar.id,
          sales_reference: "S00999",
          sale_type_id: saleType.id,
          flow_stage_id: lead.id,
          flow_snapshot_id: snapshot.id,
        })

        await expect(
          opportunityService.updateStatus(deal.id, qualified.id, registrar.id),
        ).rejects.toThrow(/Purchasing Group/)

        await opportunityService.addMember(deal.id, buyer.id, registrar.id)

        const moved = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        expect(moved.flow_stage_id).toBe(qualified.id)
      })

      it("is satisfied by a team selector when a deal-team member's sub-department matches", async () => {
        makeStageCondition({
          stage_id: lead.id,
          kind: "assignment",
          label: "Someone from Purchasing team",
          config: { who: [{ type: "team", team: "PURCHASING" }] },
        })
        const snapshot = makeFlowSnapshot({ flow_id: flow.id })
        const deal = makeOpportunity({
          registered_by: registrar.id,
          sales_reference: "S00999",
          sale_type_id: saleType.id,
          flow_stage_id: lead.id,
          flow_snapshot_id: snapshot.id,
        })
        const buyer = makeEmployee({ name: "Rey Santos", sub_department: "Purchasing" })

        await expect(
          opportunityService.updateStatus(deal.id, qualified.id, registrar.id),
        ).rejects.toThrow(/Purchasing team/)

        await opportunityService.addMember(deal.id, buyer.id, registrar.id)

        const moved = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        expect(moved.flow_stage_id).toBe(qualified.id)
      })
    })

    describe("tickbox", () => {
      it("satisfies a tickbox condition and records who and when", async () => {
        const condition = makeStageCondition({
        stage_id: lead.id,
          kind: "tickbox",
          label: "Bid documents transmitted",
        })
        makeFlowSnapshot({ flow_id: flow.id })
      const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

        const status = await opportunityService.satisfyCondition(
          created.id,
          condition.id,
          registrar.id,
        )

        expect(status.satisfied_by).toBe(registrar.id)
        expect(status.satisfied_at).toBeTruthy()
        const notes = (await opportunityService.getNotes(created.id)).map((n) => n.content)
        expect(notes).toContain('Condition satisfied: "Bid documents transmitted".')
      })

      it("is idempotent — ticking an already-satisfied condition again keeps the original satisfier", async () => {
        const condition = makeStageCondition({
        stage_id: lead.id, kind: "tickbox" })
        makeFlowSnapshot({ flow_id: flow.id })
      const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)
        const other = makeEmployee({ name: "Someone Else" })

        const first = await opportunityService.satisfyCondition(created.id, condition.id, registrar.id)
        const second = await opportunityService.satisfyCondition(created.id, condition.id, other.id)

        expect(second.id).toBe(first.id)
        expect(second.satisfied_by).toBe(registrar.id)
        const notes = (await opportunityService.getNotes(created.id)).filter((n) =>
          n.content.includes("Condition satisfied"),
        )
        expect(notes).toHaveLength(1)
      })

      it("refuses to satisfy a non-tickbox condition this way", async () => {
        const condition = makeStageCondition({
        stage_id: lead.id,
          kind: "field",
          config: { column: "po_date" },
        })
        makeFlowSnapshot({ flow_id: flow.id })
      const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

        await expect(
          opportunityService.satisfyCondition(created.id, condition.id, registrar.id),
        ).rejects.toThrow(/Only a tickbox condition/)
      })

      it("refuses to satisfy an archived condition", async () => {
        const condition = makeStageCondition({
        stage_id: lead.id,
          kind: "tickbox",
          archived_at: "2026-01-01T00:00:00.000Z",
        })
        makeFlowSnapshot({ flow_id: flow.id })
      const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

        await expect(
          opportunityService.satisfyCondition(created.id, condition.id, registrar.id),
        ).rejects.toThrow(/archived/)
      })
    })

    // Issue #203 — Stage Fields: a required field with no value blocks
    // leaving the Stage, named in the refusal; saving it (whether through the
    // SOR's own column or, for a custom field, its visit row) unblocks.
    describe("Stage Fields", () => {
      it("refuses to leave a stage with a required sor-source field left blank", async () => {
        makeStageField({
          stage_id: lead.id,
          label: "Expected Award Date",
          source: "sor",
          sor_field: "expected_award_date",
          is_required: true,
        })
        const snapshot = makeFlowSnapshot({ flow_id: flow.id })
        const deal = makeOpportunity({
          registered_by: registrar.id,
          sales_reference: "S00999",
          sale_type_id: saleType.id,
          flow_stage_id: lead.id,
          flow_snapshot_id: snapshot.id,
        })

        await expect(
          opportunityService.updateStatus(deal.id, qualified.id, registrar.id),
        ).rejects.toThrow(/Fill in: Expected Award Date/)
      })

      it("passes once the sor-source field is saved through the SOR's own column", async () => {
        makeStageField({
          stage_id: lead.id,
          label: "Expected Award Date",
          source: "sor",
          sor_field: "expected_award_date",
          is_required: true,
        })
        const snapshot = makeFlowSnapshot({ flow_id: flow.id })
        const deal = makeOpportunity({
          registered_by: registrar.id,
          sales_reference: "S00999",
          sale_type_id: saleType.id,
          flow_stage_id: lead.id,
          flow_snapshot_id: snapshot.id,
        })

        await opportunityService.updateOpportunity(
          deal.id,
          { expected_award_date: "2026-10-01" },
          registrar.id,
        )

        const moved = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        expect(moved.flow_stage_id).toBe(qualified.id)
      })

      it("saving an sor-source Stage Field leaves the Deal Team and Product List untouched", async () => {
        makeStageField({
          stage_id: lead.id,
          label: "Sales Reference",
          source: "sor",
          sor_field: "sales_reference",
          is_required: false,
        })
        const snapshot = makeFlowSnapshot({ flow_id: flow.id })
        const deal = makeOpportunity({
          registered_by: registrar.id,
          sales_reference: "S00999",
          sale_type_id: saleType.id,
          flow_stage_id: lead.id,
          flow_snapshot_id: snapshot.id,
        })
        const member = makeEmployee({ name: "Team Member" })
        await opportunityService.addMember(deal.id, member.id, registrar.id)
        const item = makeOpportunityItem(deal.id, { product_name: "Widget" })

        await opportunityService.updateOpportunity(
          deal.id,
          { sales_reference: "S01234" },
          registrar.id,
        )

        const members = await opportunityService.getMembers(deal.id)
        expect(members.map((m) => m.employee_id)).toEqual([member.id])
        const items = db.rows("sales_opportunity_items").filter((i) => i.opportunity_id === deal.id)
        expect(items.map((i) => i.id)).toEqual([item.id])
      })
    })

    // Issue #203, stories 28/32 — Stage Visits: a loop back opens a new
    // visit, and evidence given on a visit that has since closed no longer
    // satisfies a return trip to the same Stage.
    describe("Stage Visits", () => {
      it("records two visits for a loop out and back; a Resume carries the tickbox certification to the new visit", async () => {
        makeFlowEdge(qualified, lead)
        const condition = makeStageCondition({
          stage_id: lead.id,
          kind: "tickbox",
          label: "Re-verified on return",
        })
        const snapshot = makeFlowSnapshot({ flow_id: flow.id })
        const deal = makeOpportunity({
          registered_by: registrar.id,
          sales_reference: "S00999",
          sale_type_id: saleType.id,
          flow_stage_id: lead.id,
          flow_snapshot_id: snapshot.id,
        })

        await opportunityService.satisfyCondition(deal.id, condition.id, registrar.id)
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        const backOnLead = await opportunityService.updateStatus(deal.id, lead.id, registrar.id, RESUME)
        expect(backOnLead.flow_stage_id).toBe(lead.id)

        const visits = db
          .rows("sor_stage_visits")
          .filter((v) => v.opportunity_id === deal.id && v.flow_stage_id === lead.id)
        expect(visits).toHaveLength(2)

        const checklist = await opportunityService.getStageChecklist(deal.id, backOnLead)
        const row = checklist.find((c) => c.condition.id === condition.id)
        expect(row.status).toBe("satisfied")
      })
    })
  })

  describe("Deal Owner visibility (ticket 6)", () => {
    let saleType, flow, lead, qualified
    beforeEach(() => {
      saleType = makeSaleType({ name: "Flow" })
      flow = makeSalesFlow({ sale_type_id: saleType.id })
      lead = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
      qualified = makeFlowStage({ flow_id: flow.id, name: "Qualified", sort_order: 1 })
      makeFlowEdge(lead, qualified)
    })

    const flowPayload = (overrides = {}) => payload({ sale_type_id: saleType.id, ...overrides })
    describe("getStageChecklist", () => {
      it("lists the current Stage's live conditions with their status", async () => {
        makeStageCondition({
        stage_id: lead.id,
          kind: "tickbox",
          label: "Bid documents checked",
        })
        makeStageCondition({
        stage_id: lead.id,
          kind: "attachment",
          label: "Notice of Award",
          config: { documentType: "NOA" },
        })
        makeFlowSnapshot({ flow_id: flow.id })
        const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

        const checklist = await opportunityService.getStageChecklist(created.id)

        const byLabel = Object.fromEntries(checklist.map((c) => [c.condition.label, c.status]))
        expect(byLabel["Bid documents checked"]).toBe("unsatisfied")
        expect(byLabel["Notice of Award"]).toBe("unsatisfied")
      })

      // Issue #203: field is a removed kind — not_applicable, so it never
      // shows on the checklist at all, regardless of the record.
      it("leaves out a field condition — it's a removed kind", async () => {
        makeStageCondition({
          stage_id: lead.id,
          kind: "field",
          label: "PO Date on file",
          config: { column: "po_date" },
        })
        makeFlowSnapshot({ flow_id: flow.id })
        const created = await opportunityService.createOpportunity(
          flowPayload({ po_date: "2026-04-01" }),
          registrar.id,
        )

        expect(await opportunityService.getStageChecklist(created.id)).toHaveLength(0)
      })

      it("leaves out a deadline condition — it never blocks and has its own display surface", async () => {
        makeStageCondition({
        stage_id: lead.id, kind: "deadline", config: { days: 5 } })
        makeFlowSnapshot({ flow_id: flow.id })
        const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

        expect(await opportunityService.getStageChecklist(created.id)).toHaveLength(0)
      })

      it("leaves out an archived condition", async () => {
        makeStageCondition({
        stage_id: lead.id,
          kind: "tickbox",
          label: "Old check",
          archived_at: "2026-01-01T00:00:00.000Z",
        })
        makeFlowSnapshot({ flow_id: flow.id })
        const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

        expect(await opportunityService.getStageChecklist(created.id)).toHaveLength(0)
      })

      it("only reads the deal's own current Stage, not conditions configured elsewhere", async () => {
        makeStageCondition({ stage_id: qualified.id, kind: "tickbox", label: "Elsewhere" })
        makeFlowSnapshot({ flow_id: flow.id })
        const created = await opportunityService.createOpportunity(flowPayload(), registrar.id) // status LEAD

        expect(await opportunityService.getStageChecklist(created.id)).toHaveLength(0)
      })
    })

    describe("getBlockedDeals", () => {
      it("flags a deal missing a required item, and leaves an unblocked one out of the result", async () => {
        makeStageCondition({
        stage_id: lead.id,
          kind: "tickbox",
          label: "Bid documents transmitted",
        })
        makeFlowSnapshot({ flow_id: flow.id })
        const blocked = await opportunityService.createOpportunity(flowPayload(), registrar.id)
        makeFlowSnapshot({ flow_id: flow.id })
        const clear = await opportunityService.createOpportunity(flowPayload(), registrar.id)
        await opportunityService.satisfyCondition(
          clear.id,
          (await opportunityService.getStageChecklist(clear.id))[0].condition.id,
          registrar.id,
        )

        const result = await opportunityService.getBlockedDeals([
          await opportunityService.getOpportunityById(blocked.id),
          await opportunityService.getOpportunityById(clear.id),
        ])

        expect(result[blocked.id].map((r) => r.label)).toEqual(["Bid documents transmitted"])
        expect(result[clear.id]).toBeUndefined()
      })

      it("does not flag a deal on an optional condition", async () => {
        makeStageCondition({
        stage_id: lead.id,
          kind: "tickbox",
          label: "Nice to have",
          is_required: false,
        })
        makeFlowSnapshot({ flow_id: flow.id })
        const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

        const result = await opportunityService.getBlockedDeals([
          await opportunityService.getOpportunityById(created.id),
        ])

        expect(result[created.id]).toBeUndefined()
      })

      // Issue #203: field is a removed kind — not_applicable, so it never
      // blocks regardless of the record.
      it("does not flag a deal on a field condition — it's a removed kind", async () => {
        makeStageCondition({
          stage_id: lead.id,
          kind: "field",
          label: "PO Date on file",
          config: { column: "po_date" },
        })
        makeFlowSnapshot({ flow_id: flow.id })
        const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

        const result = await opportunityService.getBlockedDeals([
          await opportunityService.getOpportunityById(created.id),
        ])

        expect(result[created.id]).toBeUndefined()
      })

      it("does not flag a deal on a deadline condition, even marked required — it never blocks", async () => {
        makeStageCondition({
        stage_id: lead.id,
          kind: "deadline",
          is_required: true,
          config: { days: 5 },
        })
        makeFlowSnapshot({ flow_id: flow.id })
        const created = await opportunityService.createOpportunity(flowPayload(), registrar.id)

        const result = await opportunityService.getBlockedDeals([
          await opportunityService.getOpportunityById(created.id),
        ])

        expect(result[created.id]).toBeUndefined()
      })

      it("does not error, and blocks nothing, for a legacy deal running the global pipeline alongside a flow deal", async () => {
        // stage_conditions.stage_id is a uuid FK into flow_stages — a legacy
        // deal's currentStageId is a pipeline code like "LEAD", which can
        // never be a real Stage Condition's key. Passing it through used to
        // throw (22P02, invalid input syntax for type uuid) the moment any
        // legacy deal was in the register alongside a flow-built one.
        makeStageCondition({ stage_id: lead.id, kind: "tickbox", label: "Bid documents transmitted" })
        makeFlowSnapshot({ flow_id: flow.id })
        const flowDeal = await opportunityService.createOpportunity(flowPayload(), registrar.id)
        const legacyDeal = await opportunityService.createOpportunity(payload(), registrar.id)

        const result = await opportunityService.getBlockedDeals([
          await opportunityService.getOpportunityById(flowDeal.id),
          await opportunityService.getOpportunityById(legacyDeal.id),
        ])

        expect(result[flowDeal.id].map((r) => r.label)).toEqual(["Bid documents transmitted"])
        expect(result[legacyDeal.id]).toBeUndefined()
      })

      it("returns nothing for an empty register", async () => {
        expect(await opportunityService.getBlockedDeals([])).toEqual({})
      })

      it("does not error on the deadline read either, for a legacy deal beside a flow deal", async () => {
        // Same defect as the test above, in the other batch reader:
        // `deadlineEvaluations` derived its Stage list from
        // `flow_stage_id || status`, so a legacy deal put "LEAD" into a uuid
        // IN-list and 22P02'd the Opportunities tab on first load — for every
        // deal, not just the legacy one.
        makeStageCondition({ stage_id: lead.id, kind: "deadline", config: { days: 5 } })
        makeFlowSnapshot({ flow_id: flow.id })
        const flowDeal = await opportunityService.createOpportunity(flowPayload(), registrar.id)
        const legacyDeal = await opportunityService.createOpportunity(payload(), registrar.id)

        const result = await opportunityService.getDeadlineStatuses([
          await opportunityService.getOpportunityById(flowDeal.id),
          await opportunityService.getOpportunityById(legacyDeal.id),
        ])

        expect(result[legacyDeal.id]).toBeUndefined()
      })
    })
  })

  describe.skip("Deadline kind — countdown + notifications (ticket 7)", () => {
    // The fake store stamps created_at from its own deterministic internal
    // clock (src/test/db/store.js), not the real one — vi.useFakeTimers()
    // has no effect on it. Rather than fight two disconnected clocks, these
    // tests backdate a row's own created_at directly (prior art: the "does
    // not block on an archived condition" test above pokes archived_at the
    // same way) and let the service's `new Date()` stay real. daysAgo(n)
    // keeps that arithmetic in one place instead of repeating it per test.
    const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
    const backdateOpportunity = (id, iso) => {
      db.internal.rowsOf("sales_opportunities").find((o) => o.id === id).created_at = iso
    }

    describe("getDeadlineStatuses", () => {
      it("counts down from the deal's Stage-entry time", async () => {
        makeStageCondition({
          stage_code: "LEAD",
          kind: "deadline",
          label: "Confirm receipt",
          config: { days: 10 },
        })
        const created = await opportunityService.createOpportunity(payload(), registrar.id)
        // LEAD is its first Stage — nothing moved it there, so entry time
        // falls back to the opportunity's own created_at (D42).
        backdateOpportunity(created.id, daysAgo(3))

        const statuses = await opportunityService.getDeadlineStatuses([
          await opportunityService.getOpportunityById(created.id),
        ])

        expect(statuses[created.id]).toMatchObject({ daysRemaining: 7, isBreached: false })
        expect(statuses[created.id].condition.label).toBe("Confirm receipt")
      })

      it("measures from the move into the current Stage, not from registration", async () => {
        makeStageCondition({ stage_code: "PROPOSAL_SUBMITTED", kind: "deadline", config: { days: 10 } })
        const lead = await opportunityService.createOpportunity(
          payload({ sales_reference: "S00999" }),
          registrar.id,
        )
        // Registered a month ago...
        backdateOpportunity(lead.id, daysAgo(30))
        await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id)
        // ...but only entered the deadline's Stage 3 days ago — the clock has
        // to start there, not a month early.
        const moveLog = db.internal
          .rowsOf("sales_opportunity_logs")
          .find(
            (l) =>
              l.opportunity_id === lead.id &&
              l.metadata?.event === "STAGE_CHANGED" &&
              l.metadata?.to === "PROPOSAL_SUBMITTED",
          )
        moveLog.created_at = daysAgo(3)

        const statuses = await opportunityService.getDeadlineStatuses([
          await opportunityService.getOpportunityById(lead.id),
        ])

        expect(statuses[lead.id].daysRemaining).toBe(7)
      })

      it("is absent for a deal whose Stage carries no deadline condition", async () => {
        const created = await opportunityService.createOpportunity(payload(), registrar.id)

        const statuses = await opportunityService.getDeadlineStatuses([
          await opportunityService.getOpportunityById(created.id),
        ])

        expect(statuses[created.id]).toBeUndefined()
      })
    })

    describe("checkDeadlineNotifications", () => {
      it("notifies the Deal Owner once a deadline is approaching, and narrates it on the timeline", async () => {
        makeStageCondition({
          stage_code: "LEAD",
          kind: "deadline",
          label: "Confirm receipt",
          config: { days: 10 },
        })
        const created = await opportunityService.createOpportunity(payload(), registrar.id)
        backdateOpportunity(created.id, daysAgo(7)) // 3 days left — the threshold

        const notified = await opportunityService.checkDeadlineNotifications([
          await opportunityService.getOpportunityById(created.id),
        ])

        expect(notified).toHaveLength(1)
        expect(notified[0]).toMatchObject({ opportunityId: created.id, milestone: "APPROACHING" })

        const notes = (await opportunityService.getNotes(created.id)).map((n) => n.content)
        expect(notes.some((c) => c.includes('Deadline approaching: "Confirm receipt"'))).toBe(true)

        const notifications = await notificationService.getMyNotifications(owner.id)
        expect(notifications.some((n) => n.type === "OPPORTUNITY_DEADLINE_APPROACHING")).toBe(true)
      })

      it("fires its own notification once the deadline breaches, on top of the earlier approaching one", async () => {
        makeStageCondition({ stage_code: "LEAD", kind: "deadline", label: "Confirm receipt", config: { days: 10 } })
        const created = await opportunityService.createOpportunity(payload(), registrar.id)

        backdateOpportunity(created.id, daysAgo(7)) // approaching
        await opportunityService.checkDeadlineNotifications([
          await opportunityService.getOpportunityById(created.id),
        ])

        backdateOpportunity(created.id, daysAgo(11)) // now breached
        const notified = await opportunityService.checkDeadlineNotifications([
          await opportunityService.getOpportunityById(created.id),
        ])

        expect(notified).toHaveLength(1)
        expect(notified[0].milestone).toBe("BREACHED")

        const notes = (await opportunityService.getNotes(created.id)).map((n) => n.content)
        expect(notes.filter((c) => c.includes("Deadline approaching"))).toHaveLength(1)
        expect(notes.filter((c) => c.includes("Deadline passed"))).toHaveLength(1)
      })

      it("does not notify twice for the same milestone", async () => {
        makeStageCondition({ stage_code: "LEAD", kind: "deadline", config: { days: 10 } })
        const created = await opportunityService.createOpportunity(payload(), registrar.id)
        backdateOpportunity(created.id, daysAgo(11)) // breached

        const opp = await opportunityService.getOpportunityById(created.id)
        const first = await opportunityService.checkDeadlineNotifications([opp])
        const second = await opportunityService.checkDeadlineNotifications([opp])

        expect(first).toHaveLength(1)
        expect(second).toHaveLength(0)
      })

      it("does nothing for a deal with no Deal Owner to tell", async () => {
        makeStageCondition({ stage_code: "LEAD", kind: "deadline", config: { days: 10 } })
        const created = await opportunityService.createOpportunity(
          payload({ deal_owner_id: null }),
          registrar.id,
        )
        backdateOpportunity(created.id, daysAgo(11))

        const notified = await opportunityService.checkDeadlineNotifications([
          await opportunityService.getOpportunityById(created.id),
        ])

        expect(notified).toEqual([])
      })
    })

    describe("a breached deadline never blocks a move", () => {
      it("lets a move proceed straight through a Stage whose deadline is months overdue", async () => {
        makeStageCondition({
          stage_code: "LEAD",
          kind: "deadline",
          is_required: true,
          label: "Confirm receipt",
          config: { days: 1 },
        })
        const lead = await opportunityService.createOpportunity(
          payload({ sales_reference: "S00999" }),
          registrar.id,
        )
        backdateOpportunity(lead.id, daysAgo(60)) // months late

        const moved = await opportunityService.updateStatus(lead.id, "PROPOSAL_SUBMITTED", registrar.id)
        expect(moved.status).toBe("PROPOSAL_SUBMITTED")
      })
    })
  })

  /**
   * Issue #36 / ADR 0006 — a deal that carries a Sale Type runs its own Sales
   * Flow. Its moves are the edges the Operations Manager drew, and a move
   * traverses exactly one of them: there is no canonical path between two
   * arbitrary Stages in a graph, so the crossed-Stages interval has no meaning
   * and only the Stage being left is evaluated.
   */
  describe("deals that run a Sales Flow", () => {
    let saleType
    let flow
    let lead
    let qualified
    let awarded
    let lost

    beforeEach(() => {
      saleType = makeSaleType({ name: "Government Bidding" })
      flow = makeSalesFlow({ sale_type_id: saleType.id })
      lead = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
      qualified = makeFlowStage({ flow_id: flow.id, name: "Qualified", sort_order: 1 })
      awarded = makeFlowStage({ flow_id: flow.id, name: "Awarded", sort_order: 2 })
      lost = makeFlowStage({ flow_id: flow.id, name: "Lost", sort_order: 3, is_terminal: true })
      makeFlowEdge(lead, qualified)
      makeFlowEdge(qualified, awarded)
      makeFlowEdge(awarded, qualified)
      makeFlowEdge(lead, lost)
      db.internal.rowsOf("sales_flows").find((f) => f.id === flow.id).won_stage_id = awarded.id
    })

    // Issue #83 — a deal registers under its Sale Type's most recently
    // locked Flow Snapshot, so registration snapshots the flow right before
    // creating the opportunity. Doing it here rather than once in
    // `beforeEach` means a test's own `makeStageCondition`/`makeStageAction`
    // calls, made before it calls `register()`, are captured in the
    // snapshot the same way a real lock would have captured them.
    const register = (overrides = {}) => {
      makeFlowSnapshot({ flow_id: flow.id })
      return opportunityService.createOpportunity(
        payload({ sale_type_id: saleType.id, ...overrides }),
        registrar.id,
      )
    }

    it("lands a newly registered deal on the Stage its flow starts at", async () => {
      const created = await register()

      expect(created.sale_type_id).toBe(saleType.id)
      expect(created.flow_stage_id).toBe(lead.id)
    })

    it("moves a deal along an edge that was drawn", async () => {
      const deal = await register()

      const moved = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

      expect(moved.flow_stage_id).toBe(qualified.id)
    })

    /**
     * `status` still holds a crm_pipeline_stages code and the Sales
     * Reference / ITB triggers key off it changing on UPDATE (migration
     * 0011/0036). Writing a flow Stage's name into `status` to keep a display
     * badge current made those triggers see a phantom pipeline transition and
     * demand a Sales Reference to "leave Lead" on every flow move — even
     * though a Sales Flow move was never subject to that gate.
     */
    it("never touches the legacy status column, so the Sales Reference gate stays silent", async () => {
      const deal = await register()
      expect(deal.sales_reference).toBeFalsy()

      const moved = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

      expect(moved.status).toBe(deal.status)
    })

    it("refuses a move along an edge that does not exist", async () => {
      const deal = await register()

      await expect(opportunityService.updateStatus(deal.id, awarded.id, registrar.id)).rejects.toThrow(
        /Lead cannot move straight to Awarded/,
      )
    })

    it("permits a loop back that was drawn", async () => {
      const deal = await register()
      await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
      await opportunityService.updateStatus(deal.id, awarded.id, registrar.id)

      const looped = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id, RESUME)

      expect(looped.flow_stage_id).toBe(qualified.id)
    })

    it("stamps a Contract Date the first time the deal reaches its flow's Won Stage", async () => {
      const deal = await register()
      await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

      const won = await opportunityService.updateStatus(deal.id, awarded.id, registrar.id)

      expect(won.contract_date).toBeTruthy()
    })

    it("keeps the Contract Date when the deal loops back out of the Won Stage", async () => {
      // ADR 0006 — Realized is a fact about the deal, and a later move cannot
      // unsay that it was won. The positional rule needed a special case here.
      const deal = await register()
      await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
      const won = await opportunityService.updateStatus(deal.id, awarded.id, registrar.id)

      const reopened = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id, RESUME)

      expect(reopened.contract_date).toBe(won.contract_date)
    })

    it("records the move on the timeline with both Stage names", async () => {
      const deal = await register()
      await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

      const notes = await opportunityService.getNotes(deal.id)
      const move = notes.find((n) => n.metadata?.event === "STAGE_CHANGED")
      expect(move.content).toContain("Lead")
      expect(move.content).toContain("Qualified")
    })

    it("refuses a move naming a Stage from another flow", async () => {
      const deal = await register()
      const elsewhere = makeFlowStage({ name: "Somewhere Else" })

      await expect(
        opportunityService.updateStatus(deal.id, elsewhere.id, registrar.id),
      ).rejects.toThrow(/not a Stage in this deal's flow/)
    })

    it("leaves a legacy deal on the global pipeline entirely alone", async () => {
      // The expand half of an expand–contract: until existing SORs are
      // migrated onto the locked flows, a deal with no Sale Type is gated
      // exactly as it was before any of this existed.
      const legacy = await opportunityService.createOpportunity(payload(), registrar.id)

      const moved = await opportunityService.updateStatus(legacy.id, "QUALIFIED", registrar.id, { salesReference: "S01237" })

      expect(moved.status).toBe("QUALIFIED")
      expect(moved.flow_stage_id).toBeNull()
      expect(lost.id).toBeTruthy()
    })

    describe("an Individual Task's assignee hears about the task, not the deal", () => {
      it("notifies the assignee by name and points the notification at the task", async () => {
        const assignee = makeEmployee({ name: "Techie Tina" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { projectTitle: "Check the specs", loggedById: assignee.id },
        })
        const spy = vi.spyOn(notificationService, "createNotification")

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const task = db.internal.rowsOf("tasks").find((t) => t.opportunity_id === deal.id)
        expect(task).toBeTruthy()

        // createTask already sends this: a Stage Action always submits on
        // someone else's behalf, so submittedById !== loggedById.
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            recipient_id: assignee.id,
            type: "TASK_ASSIGNED",
            reference_id: task.id,
          }),
        )

        // ...and the vaguer "Added to a deal" must not arrive alongside it.
        expect(spy).not.toHaveBeenCalledWith(
          expect.objectContaining({ recipient_id: assignee.id, type: "SOR_STAGE_PARTICIPANT_ADDED" }),
        )
        spy.mockRestore()
      })
    })

    describe("Stage Actions fire once per (deal, stage, action)", () => {
      it("does not refire an action on loop-back — sor_action_runs is the gate, not a log marker", async () => {
        // Issue #204 Part 2 — fire-once is now a real per-(opportunity,
        // stage, action) row in sor_action_runs via sor_begin_action_run's
        // upsert-if-absent, replacing the old STAGE_ACTIONS_FIRED log
        // marker + ILIKE-on-description fallback entirely.
        const action = makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { title: "Confirm requirements" },
        })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        // Issue #199 — the move resolves after its Stage Actions, so the task
        // is already there without polling.
        expect(db.internal.rowsOf("tasks").filter((t) => t.opportunity_id === deal.id)).toHaveLength(1)

        const run = db.internal
          .rowsOf("sor_action_runs")
          .find((r) => r.opportunity_id === deal.id && r.action_id === action.id)
        expect(run).toBeTruthy()
        expect(run.outcome).toBe("created")

        await opportunityService.updateStatus(deal.id, awarded.id, registrar.id)
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id, RESUME)

        const tasksAfterLoopBack = db.internal
          .rowsOf("tasks")
          .filter((t) => t.opportunity_id === deal.id)
        expect(tasksAfterLoopBack).toHaveLength(1)

        // Still exactly one run for this (opportunity, stage, action).
        const runsAfterLoopBack = db.internal
          .rowsOf("sor_action_runs")
          .filter((r) => r.opportunity_id === deal.id && r.action_id === action.id)
        expect(runsAfterLoopBack).toHaveLength(1)
      })

      it("fires independently for two stages sharing a name prefix (per-action-id gate, not string matching)", async () => {
        const otherStage = makeFlowStage({ flow_id: qualified.flow_id, name: "Qualified Extra" })
        makeFlowEdge(qualified, otherStage)
        const action1 = makeStageAction({ stage_id: qualified.id, kind: "create_individual_task", config: {} })
        const action2 = makeStageAction({ stage_id: otherStage.id, kind: "create_individual_task", config: {} })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        await opportunityService.updateStatus(deal.id, otherStage.id, registrar.id)

        const tasks = db.internal.rowsOf("tasks").filter((t) => t.opportunity_id === deal.id)
        expect(tasks).toHaveLength(2)
        expect(tasks.map((t) => t.stage_action_id).sort()).toEqual([action1.id, action2.id].sort())
      })
    })

    describe("Optional Actions — When confirmed (issue #204 Part 2)", () => {
      it("creates nothing until decided, and notifies the Decider", async () => {
        const decider = makeEmployee({ name: "Decider Dana" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { title: "Approve pricing", confirmMode: "confirm", decider: [{ type: "employee", id: decider.id }] },
        })
        const spy = vi.spyOn(notificationService, "createNotification")

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        expect(db.internal.rowsOf("tasks").filter((t) => t.opportunity_id === deal.id)).toHaveLength(0)
        const run = db.internal
          .rowsOf("sor_action_runs")
          .find((r) => r.opportunity_id === deal.id)
        expect(run).toBeTruthy()
        expect(run.outcome).toBe("pending")
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({ recipient_id: decider.id, type: "OPPORTUNITY_ACTION_DECISION_DUE", reference_id: deal.id }),
        )
        spy.mockRestore()
      })

      it("renders the title template's tokens in the decision-due notification", async () => {
        const decider = makeEmployee({ name: "Decider Dana" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: {
            titleTemplate: "QA401 S2 optional (D decides) — {{so_number}}",
            confirmMode: "confirm",
            decider: [{ type: "employee", id: decider.id }],
          },
        })
        const spy = vi.spyOn(notificationService, "createNotification")

        const deal = await register({ sales_reference: "S94001" })
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            recipient_id: decider.id,
            type: "OPPORTUNITY_ACTION_DECISION_DUE",
            title: "QA401 S2 optional (D decides) — S94001",
          }),
        )
        spy.mockRestore()
      })

      it("Create produces the same task an automatic run would", async () => {
        const decider = makeEmployee({ name: "Decider Dana" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { title: "Approve pricing", confirmMode: "confirm", decider: [{ type: "employee", id: decider.id }] },
        })

        const deal = await register({ sales_reference: "S09911" })
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const run = db.internal.rowsOf("sor_action_runs").find((r) => r.opportunity_id === deal.id)
        const result = await opportunityService.decideAction(run.id, "create", decider.id)
        expect(result.outcome).toBe("created")

        const task = db.internal.rowsOf("tasks").find((t) => t.opportunity_id === deal.id)
        expect(task).toBeTruthy()
        expect(task.project_title).toBe("[S09911] [Fire truck supply]")
        expect(task.stage_action_id).toBe(run.action_id)

        const decided = db.internal.rowsOf("sor_action_runs").find((r) => r.id === run.id)
        expect(decided.outcome).toBe("created")
        expect(decided.task_id).toBe(task.id)
      })

      it("Skip creates nothing and logs the skip", async () => {
        const decider = makeEmployee({ name: "Decider Dana" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { title: "Approve pricing", confirmMode: "confirm", decider: [{ type: "employee", id: decider.id }] },
        })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        const run = db.internal.rowsOf("sor_action_runs").find((r) => r.opportunity_id === deal.id)

        const result = await opportunityService.decideAction(run.id, "skip", decider.id)
        expect(result.outcome).toBe("skipped")
        expect(db.internal.rowsOf("tasks").filter((t) => t.opportunity_id === deal.id)).toHaveLength(0)

        const notes = await opportunityService.getNotes(deal.id)
        expect(notes.some((n) => n.metadata?.event === "ACTION_RUN_SKIPPED")).toBe(true)
      })

      it("refuses a non-Decider calling decideAction", async () => {
        const decider = makeEmployee({ name: "Decider Dana" })
        const stranger = makeEmployee({ name: "Stranger Steve" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { title: "Approve pricing", confirmMode: "confirm", decider: [{ type: "employee", id: decider.id }] },
        })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        const run = db.internal.rowsOf("sor_action_runs").find((r) => r.opportunity_id === deal.id)

        await expect(opportunityService.decideAction(run.id, "create", stranger.id)).rejects.toThrow()
        expect(db.internal.rowsOf("tasks").filter((t) => t.opportunity_id === deal.id)).toHaveLength(0)
      })

      it("marks a pending run skipped with a timeline entry when the deal leaves the Stage undecided, and does not re-offer it on re-entry", async () => {
        const decider = makeEmployee({ name: "Decider Dana" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { title: "Approve pricing", confirmMode: "confirm", decider: [{ type: "employee", id: decider.id }] },
        })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        await opportunityService.updateStatus(deal.id, awarded.id, registrar.id)

        const run = db.internal.rowsOf("sor_action_runs").find((r) => r.opportunity_id === deal.id)
        expect(run.outcome).toBe("skipped")

        const notes = await opportunityService.getNotes(deal.id)
        expect(notes.some((n) => n.metadata?.event === "ACTION_RUN_SKIPPED" && n.content.includes("Qualified"))).toBe(true)

        // Re-entering Qualified must not re-offer the same action.
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id, RESUME)
        const runsAfter = db.internal.rowsOf("sor_action_runs").filter((r) => r.opportunity_id === deal.id)
        expect(runsAfter).toHaveLength(1)
        expect(runsAfter[0].outcome).toBe("skipped")
        expect(db.internal.rowsOf("tasks").filter((t) => t.opportunity_id === deal.id)).toHaveLength(0)
      })

      it("resolves a group Decider via Employee Groups", async () => {
        const member = makeEmployee({ name: "Group Member Gary" })
        const group = makeEmployeeGroup({ employeeIds: [member.id] })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { title: "Approve pricing", confirmMode: "confirm", decider: [{ type: "group", id: group.id }] },
        })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        const run = db.internal.rowsOf("sor_action_runs").find((r) => r.opportunity_id === deal.id)

        const result = await opportunityService.decideAction(run.id, "skip", member.id)
        expect(result.outcome).toBe("skipped")
      })

      it("defaults an unconfigured Decider to the Deal Owner", async () => {
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { title: "Approve pricing", confirmMode: "confirm" },
        })
        const spy = vi.spyOn(notificationService, "createNotification")

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({ recipient_id: owner.id, type: "OPPORTUNITY_ACTION_DECISION_DUE", reference_id: deal.id }),
        )
        spy.mockRestore()

        const run = db.internal.rowsOf("sor_action_runs").find((r) => r.opportunity_id === deal.id)
        const result = await opportunityService.decideAction(run.id, "create", owner.id)
        expect(result.outcome).toBe("created")
      })
    })

    describe("getPendingActionsForActor (issue #204 Part 2, the Decider card)", () => {
      it("returns a rendered title and target for the resolved Decider", async () => {
        const decider = makeEmployee({ name: "Decider Dana" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { titleTemplate: "Approve {{project_title}}", confirmMode: "confirm", decider: [{ type: "employee", id: decider.id }] },
        })

        const deal = await register({ project_title: "Fire truck supply" })
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const pending = await opportunityService.getPendingActionsForActor(deal.id, decider.id)
        expect(pending).toHaveLength(1)
        expect(pending[0].title).toBe("Approve Fire truck supply")
        expect(pending[0].target).toEqual({ kind: "individual", assignee: null })
        expect(pending[0].stageName).toBe("Qualified")
      })

      it("names the configured assignee rather than defaulting to the decider", async () => {
        const decider = makeEmployee({ name: "Decider Dana" })
        const assignee = makeEmployee({ name: "Assignee Andy" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { title: "Approve pricing", confirmMode: "confirm", loggedById: assignee.id, decider: [{ type: "employee", id: decider.id }] },
        })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const pending = await opportunityService.getPendingActionsForActor(deal.id, decider.id)
        expect(pending[0].target).toEqual({ kind: "individual", assignee: { id: assignee.id, name: "Assignee Andy" } })
      })

      it("returns nothing for someone who isn't a Decider on any pending run", async () => {
        const decider = makeEmployee({ name: "Decider Dana" })
        const stranger = makeEmployee({ name: "Stranger Steve" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { title: "Approve pricing", confirmMode: "confirm", decider: [{ type: "employee", id: decider.id }] },
        })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const pending = await opportunityService.getPendingActionsForActor(deal.id, stranger.id)
        expect(pending).toHaveLength(0)
      })

      it("omits a run once it has been decided", async () => {
        const decider = makeEmployee({ name: "Decider Dana" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { title: "Approve pricing", confirmMode: "confirm", decider: [{ type: "employee", id: decider.id }] },
        })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        const run = db.internal.rowsOf("sor_action_runs").find((r) => r.opportunity_id === deal.id)
        await opportunityService.decideAction(run.id, "skip", decider.id)

        const pending = await opportunityService.getPendingActionsForActor(deal.id, decider.id)
        expect(pending).toHaveLength(0)
      })

      it("names a group task's actual assignees, not just a count", async () => {
        const decider = makeEmployee({ name: "Decider Dana" })
        const a1 = makeEmployee({ name: "Assignee A" })
        const a2 = makeEmployee({ name: "Assignee B" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_group_task",
          config: {
            confirmMode: "confirm",
            decider: [{ type: "employee", id: decider.id }],
            members: [
              { employeeId: a1.id, role: "Assignee", taskDescription: "Do it" },
              { employeeId: a2.id, role: "Assignee", taskDescription: "Do it too" },
            ],
          },
        })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const pending = await opportunityService.getPendingActionsForActor(deal.id, decider.id)
        expect(pending).toHaveLength(1)
        expect(pending[0].target).toEqual({
          kind: "group",
          members: [
            { id: a1.id, name: "Assignee A" },
            { id: a2.id, name: "Assignee B" },
          ],
        })
      })
    })

    describe("a Stage Action that fails", () => {
      it("keeps the move, still runs the other actions, and names the failed one", async () => {
        const { taskService } = await import("./taskService")
        makeStageAction({ stage_id: qualified.id, kind: "create_individual_task", config: { projectTitle: "Broken action" }, sort_order: 1 })
        makeStageAction({ stage_id: qualified.id, kind: "create_group_task", config: { title: "Working action" }, sort_order: 2 })
        const spy = vi.spyOn(taskService, "createTask").mockRejectedValueOnce(new Error("category missing"))

        const deal = await register()
        const moved = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        spy.mockRestore()

        expect(moved.flow_stage_id).toBe(qualified.id)
        expect(moved.failedStageActions).toEqual(["Broken action"])
        expect(db.internal.rowsOf("committee_tasks").filter((t) => t.opportunity_id === deal.id)).toHaveLength(1)
        expect((await opportunityService.getOpportunityById(deal.id)).flow_stage_id).toBe(qualified.id)
      })

      it("reports no failures when every action runs", async () => {
        makeStageAction({ stage_id: qualified.id, kind: "create_individual_task", config: {} })

        const deal = await register()
        const moved = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        expect(moved.failedStageActions).toEqual([])
      })
    })

    describe("Follow-up Cadence (issue #204 Part 3)", () => {
      it("refuses when the current Stage carries no cadence at all", async () => {
        const deal = await register()

        await expect(opportunityService.logFollowUp(deal.id, {}, owner.id)).rejects.toThrow(
          /no active Follow-up Cadence/,
        )
      })

      it("refuses to log without proof when the cadence requires it", async () => {
        makeFollowUpCadence({ stage_id: qualified.id, proof_required: true })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        await expect(
          opportunityService.logFollowUp(deal.id, { note: "Called the client" }, owner.id),
        ).rejects.toThrow(/proof/i)
      })

      it("logs a follow-up with its files on the timeline when proof is attached", async () => {
        makeFollowUpCadence({ stage_id: qualified.id, proof_required: true })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const file = { url: "https://res.cloudinary.com/demo/proof.pdf", name: "proof.pdf", type: "application/pdf" }
        await opportunityService.logFollowUp(deal.id, { note: "Called the client", attachments: [file] }, owner.id)

        const notes = await opportunityService.getNotes(deal.id)
        const entry = notes.find((n) => n.metadata?.event === "FOLLOW_UP_LOGGED")
        expect(entry).toBeTruthy()
        expect(entry.content).toMatch(/Called the client/)
        expect(entry.metadata.attachments).toEqual([expect.objectContaining({ url: file.url })])
      })

      it("refuses a non-recipient, non-Deal-Team actor", async () => {
        makeFollowUpCadence({ stage_id: qualified.id, proof_required: false })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const stranger = makeEmployee({ name: "Stranger Steve" })
        await expect(opportunityService.logFollowUp(deal.id, {}, stranger.id)).rejects.toThrow()
      })

      it("refuses when the Stage's cadence is disabled", async () => {
        makeFollowUpCadence({ stage_id: qualified.id, enabled: false, every_days: null })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        await expect(opportunityService.logFollowUp(deal.id, {}, owner.id)).rejects.toThrow()
      })

      it("lets a resolved recipient (not on the Deal Team) log a follow-up when proof isn't required", async () => {
        const helper = makeEmployee({ name: "Helper Hannah" })
        makeFollowUpCadence({
          stage_id: qualified.id,
          proof_required: false,
          recipients: [{ type: "employee", id: helper.id }],
        })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        await opportunityService.logFollowUp(deal.id, { note: "Checked in" }, helper.id)

        const notes = await opportunityService.getNotes(deal.id)
        expect(notes.some((n) => n.metadata?.event === "FOLLOW_UP_LOGGED")).toBe(true)
      })
    })

    // Issue #178 — an automated task is named after the deal, not the Stage.
    describe("Stage Actions name the task after the deal", () => {
      it("titles an individual-task automation with the Sales Reference and project name, and links it to the Stage Action that created it", async () => {
        const action = makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: {},
        })

        const deal = await register({ sales_reference: "S04521" })
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const task = db.internal
            .rowsOf("tasks")
            .find((t) => t.opportunity_id === deal.id)
        expect(task).toBeTruthy()

        expect(task.project_title).toBe("[S04521] [Fire truck supply]")
        // Issue #204 Part 2 — the old "(Auto-created on entering stage...)"
        // marker is gone; attribution now lives on stage_action_id/
        // stage_visit_id plus the STAGE_ACTION_TASK_CREATED system note.
        expect(task.task_description).not.toContain("Auto-created")
        expect(task.stage_action_id).toBe(action.id)
      })

      it("names a deal with no Sales Reference yet with a stated placeholder", async () => {
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: {},
        })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const task = db.internal
            .rowsOf("tasks")
            .find((t) => t.opportunity_id === deal.id)
        expect(task).toBeTruthy()

        expect(task.project_title).toBe("[No Sales Reference] [Fire truck supply]")
      })

      it("assigns an individual-task automation to the person picked in the Flow Canvas, not whoever triggers the move", async () => {
        const pickedAssignee = makeEmployee({ name: "Picked Assignee" })
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          // LogTaskAssignmentBar's Assign To picker saves formData.loggedById
          // straight through — see opportunityService.js's own comment on
          // the same key.
          config: { loggedById: pickedAssignee.id },
        })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const task = db.internal.rowsOf("tasks").find((t) => t.opportunity_id === deal.id)
        expect(task.logged_by).toBe(pickedAssignee.id)
      })

      it("falls back to whoever triggers the move when no assignee was ever picked", async () => {
        makeStageAction({ stage_id: qualified.id, kind: "create_individual_task", config: {} })

        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const task = db.internal.rowsOf("tasks").find((t) => t.opportunity_id === deal.id)
        expect(task.logged_by).toBe(registrar.id)
      })

      it("lets an explicitly configured individual-task title win", async () => {
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { projectTitle: "Custom automation title" },
        })

        const deal = await register({ sales_reference: "S04521" })
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const task = db.internal
            .rowsOf("tasks")
            .find((t) => t.opportunity_id === deal.id)
        expect(task).toBeTruthy()

        expect(task.project_title).toBe("Custom automation title")
      })

      it("titles a group-task automation the same way, and links it to the Stage Action that created it", async () => {
        const action = makeStageAction({
          stage_id: qualified.id,
          kind: "create_group_task",
          config: {},
        })

        const deal = await register({ sales_reference: "S04521" })
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const groupTask = db.internal
            .rowsOf("committee_tasks")
            .find((t) => t.opportunity_id === deal.id)
        expect(groupTask).toBeTruthy()

        expect(groupTask.title).toBe("[S04521] [Fire truck supply]")
        expect(groupTask.description || "").not.toContain("Auto-created")
        expect(groupTask.stage_action_id).toBe(action.id)
      })

      it("lets an explicitly configured group-task title win", async () => {
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_group_task",
          config: { title: "Custom group automation title" },
        })

        const deal = await register({ sales_reference: "S04521" })
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        const groupTask = db.internal
            .rowsOf("committee_tasks")
            .find((t) => t.opportunity_id === deal.id)
        expect(groupTask).toBeTruthy()

        expect(groupTask.title).toBe("Custom group automation title")
      })
    })

    // Issue #203: project_evaluation is a removed kind — an SOR still
    // carrying one from before this shipped is never stranded by it, since
    // it now evaluates not_applicable unconditionally.
    describe("a Stage carrying a project_evaluation condition (removed kind)", () => {
      it("never blocks leaving the Stage, with or without a Project Evaluation on record", async () => {
        makeStageCondition({
          stage_id: lead.id,
          kind: "project_evaluation",
          label: "Go/no-go decided",
        })
        const deal = await register()

        const moved = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        expect(moved.flow_stage_id).toBe(qualified.id)
      })
    })

    describe("Flow Snapshots (issue #83)", () => {
      it("keeps its old conditions after the live flow gains a new one", async () => {
        const deal = await register() // snapshot has no conditions on Lead yet

        // Added to the live Stage AFTER this deal already registered under a
        // snapshot with none — must not start blocking it.
        makeStageCondition({ stage_id: lead.id, kind: "project_evaluation", label: "New requirement" })

        const moved = await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        expect(moved.flow_stage_id).toBe(qualified.id)
      })

      it("stays blocked by a condition removed from the live Stage after it registered", async () => {
        makeStageCondition({ stage_id: lead.id, kind: "tickbox", label: "Bid documents transmitted" })
        const deal = await register() // snapshot captures this condition

        const live = db.internal
          .rowsOf("stage_conditions")
          .find((c) => c.stage_id === lead.id && c.label === "Bid documents transmitted")
        live.archived_at = new Date().toISOString()

        await expect(
          opportunityService.updateStatus(deal.id, qualified.id, registrar.id),
        ).rejects.toThrow(/Bid documents transmitted/)
      })

      it("refuses to register against a Sale Type whose flow has never been locked", async () => {
        const neverLocked = makeSaleType({ name: "Drafting" })
        makeSalesFlow({ sale_type_id: neverLocked.id })

        await expect(
          opportunityService.createOpportunity(
            payload({ sale_type_id: neverLocked.id }),
            registrar.id,
          ),
        ).rejects.toThrow(/has not been locked yet/)
      })

      it("keeps an existing SOR's Contract Date and snapshot after the Won Stage moves on a later snapshot", async () => {
        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)
        const won = await opportunityService.updateStatus(deal.id, awarded.id, registrar.id)
        expect(won.contract_date).toBeTruthy()

        // The live flow's Won Stage moves, and a new snapshot is locked
        // reflecting it — the earlier deal must not be affected by either.
        db.internal.rowsOf("sales_flows").find((f) => f.id === flow.id).won_stage_id = qualified.id
        makeFlowSnapshot({ flow_id: flow.id })

        const unchanged = await opportunityService.getOpportunityById(deal.id)
        expect(unchanged.contract_date).toBe(won.contract_date)
        expect(unchanged.flow_snapshot_id).toBe(won.flow_snapshot_id)
      })

      it("refuses to move an SOR onto a snapshot that doesn't have its current Stage", async () => {
        const deal = await register() // sits on Lead

        const strandingSnapshot = makeFlowSnapshot({
          flow_id: flow.id,
          snapshot_data: {
            stages: [qualified, awarded, lost],
            edges: [],
            actions: [],
            conditions: [],
            wonStageId: awarded.id,
            saleTypeId: saleType.id,
          },
        })

        await expect(
          opportunityService.moveOpportunitySnapshot(deal.id, strandingSnapshot.id, registrar.id),
        ).rejects.toThrow(/does not exist in Flow Snapshot/)
      })

      it("moves an SOR onto a newer snapshot and records the move on its timeline", async () => {
        const deal = await register() // v1
        const v2 = makeFlowSnapshot({ flow_id: flow.id })

        const moved = await opportunityService.moveOpportunitySnapshot(deal.id, v2.id, registrar.id)

        expect(moved.flow_snapshot_id).toBe(v2.id)
        // Only flow_snapshot_id changes — never the Stage or the Contract Date.
        expect(moved.flow_stage_id).toBe(deal.flow_stage_id)
        expect(moved.contract_date).toBe(deal.contract_date)

        const notes = await opportunityService.getNotes(deal.id)
        const note = notes.find((n) => n.metadata?.event === "FLOW_SNAPSHOT_MOVED")
        expect(note.content).toContain("v1")
        expect(note.content).toContain("v2")
        expect(note.metadata.employeeId).toBe(registrar.id)
        expect(note.metadata.from).toBe(deal.flow_snapshot_id)
        expect(note.metadata.to).toBe(v2.id)
      })

      it("does not refire a Stage Action after moving the SOR to a newer snapshot", async () => {
        makeStageAction({
          stage_id: qualified.id,
          kind: "create_individual_task",
          config: { title: "Confirm requirements" },
        })
        const deal = await register()
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id)

        await vi.waitFor(() => {
          const tasks = db.internal.rowsOf("tasks").filter((t) => t.opportunity_id === deal.id)
          expect(tasks).toHaveLength(1)
        })

        const v2 = makeFlowSnapshot({ flow_id: flow.id })
        await opportunityService.moveOpportunitySnapshot(deal.id, v2.id, registrar.id)

        await opportunityService.updateStatus(deal.id, awarded.id, registrar.id)
        await opportunityService.updateStatus(deal.id, qualified.id, registrar.id, RESUME)
        await waitForNetworkIdle()

        const tasksAfterLoopBack = db.internal
          .rowsOf("tasks")
          .filter((t) => t.opportunity_id === deal.id)
        expect(tasksAfterLoopBack).toHaveLength(1)
      })

      it("keeps two Sale Types' same-named Stages unrelated, even across snapshots", async () => {
        const otherSaleType = makeSaleType({ name: "Recruitment" })
        const otherFlow = makeSalesFlow({ sale_type_id: otherSaleType.id })
        const otherLead = makeFlowStage({ flow_id: otherFlow.id, name: "Lead", sort_order: 0 })
        makeFlowSnapshot({ flow_id: otherFlow.id })

        const deal = await register()

        expect(deal.flow_stage_id).toBe(lead.id)
        expect(deal.flow_stage_id).not.toBe(otherLead.id)

        await expect(
          opportunityService.updateStatus(deal.id, otherLead.id, registrar.id),
        ).rejects.toThrow(/not a Stage in this deal's flow/)
      })
    })

    describe("moving deals to a version after a minor publish (issue #190)", () => {
      it("moves only same-major SORs on an earlier minor, excludes soft-deleted, and includes Scratch", async () => {
        const v1 = makeFlowSnapshot({ flow_id: flow.id, version: 3, version_minor: 0 })
        const v2 = makeFlowSnapshot({ flow_id: flow.id, version: 3, version_minor: 1 })

        const onEarlierMinor = makeOpportunity({
          registered_by: registrar.id,
          sale_type_id: saleType.id,
          flow_snapshot_id: v1.id,
          flow_stage_id: lead.id,
        })
        const scratchOnEarlierMinor = makeOpportunity({
          registered_by: registrar.id,
          sale_type_id: saleType.id,
          flow_snapshot_id: v1.id,
          flow_stage_id: lead.id,
          is_scratch: true,
        })
        const deletedOnEarlierMinor = makeOpportunity({
          registered_by: registrar.id,
          sale_type_id: saleType.id,
          flow_snapshot_id: v1.id,
          flow_stage_id: lead.id,
          is_deleted: true,
        })
        const alreadyOnTarget = makeOpportunity({
          registered_by: registrar.id,
          sale_type_id: saleType.id,
          flow_snapshot_id: v2.id,
          flow_stage_id: lead.id,
        })

        const otherMajor = makeFlowSnapshot({ flow_id: flow.id, version: 2, version_minor: 3 })
        const onDifferentMajor = makeOpportunity({
          registered_by: registrar.id,
          sale_type_id: saleType.id,
          flow_snapshot_id: otherMajor.id,
          flow_stage_id: lead.id,
        })

        const count = await opportunityService.countOpportunitiesEligibleForVersionMove(v2.id)
        expect(count).toBe(2)

        const result = await opportunityService.moveOpportunitiesToVersion(v2.id, registrar.id)

        expect(result.succeeded.map((d) => d.id).sort()).toEqual(
          [onEarlierMinor.id, scratchOnEarlierMinor.id].sort(),
        )
        expect(result.failed).toEqual([])

        const moved = await opportunityService.getOpportunityById(onEarlierMinor.id)
        expect(moved.flow_snapshot_id).toBe(v2.id)
        const movedScratch = await opportunityService.getOpportunityById(scratchOnEarlierMinor.id)
        expect(movedScratch.flow_snapshot_id).toBe(v2.id)

        const untouchedDeleted = await opportunityService.getOpportunityById(deletedOnEarlierMinor.id)
        expect(untouchedDeleted.flow_snapshot_id).toBe(v1.id)
        const untouchedAlready = await opportunityService.getOpportunityById(alreadyOnTarget.id)
        expect(untouchedAlready.flow_snapshot_id).toBe(v2.id)
        const untouchedOtherMajor = await opportunityService.getOpportunityById(onDifferentMajor.id)
        expect(untouchedOtherMajor.flow_snapshot_id).toBe(otherMajor.id)

        const note = (await opportunityService.getNotes(onEarlierMinor.id)).find(
          (n) => n.metadata?.event === "FLOW_SNAPSHOT_MOVED",
        )
        expect(note.content).toContain("v3.0")
        expect(note.content).toContain("v3.1")
      })

      it("reports a partial failure without stopping the rest of the batch", async () => {
        const v1 = makeFlowSnapshot({ flow_id: flow.id, version: 3, version_minor: 0 })
        const v2 = makeFlowSnapshot({
          flow_id: flow.id,
          version: 3,
          version_minor: 1,
          snapshot_data: { ...v1.snapshot_data, stages: [qualified, awarded, lost] },
        })

        const strandable = makeOpportunity({
          registered_by: registrar.id,
          sale_type_id: saleType.id,
          flow_snapshot_id: v1.id,
          flow_stage_id: lead.id, // not in v2's stages — would be stranded
        })
        const movable = makeOpportunity({
          registered_by: registrar.id,
          sale_type_id: saleType.id,
          flow_snapshot_id: v1.id,
          flow_stage_id: qualified.id,
        })

        const result = await opportunityService.moveOpportunitiesToVersion(v2.id, registrar.id)

        expect(result.succeeded.map((d) => d.id)).toEqual([movable.id])
        expect(result.failed).toEqual([
          { id: strandable.id, reason: expect.stringContaining("does not exist in Flow Snapshot") },
        ])
      })

      it("returns nothing to move when there is no earlier minor within the same major", async () => {
        const onlyVersion = makeFlowSnapshot({ flow_id: flow.id, version: 3, version_minor: 0 })
        makeOpportunity({
          registered_by: registrar.id,
          sale_type_id: saleType.id,
          flow_snapshot_id: onlyVersion.id,
          flow_stage_id: lead.id,
        })

        expect(await opportunityService.countOpportunitiesEligibleForVersionMove(onlyVersion.id)).toBe(0)
        expect(await opportunityService.moveOpportunitiesToVersion(onlyVersion.id, registrar.id)).toEqual({
          succeeded: [],
          failed: [],
        })
      })
    })
  })

  describe("changing an SOR's Sale Type", () => {
    let bidding
    let outright
    let biddingLead
    let biddingQualified
    let outrightLead

    beforeEach(() => {
      bidding = makeSaleType({ name: "Bidding" })
      const biddingFlow = makeSalesFlow({ sale_type_id: bidding.id })
      biddingLead = makeFlowStage({ flow_id: biddingFlow.id, name: "Lead", sort_order: 0 })
      biddingQualified = makeFlowStage({ flow_id: biddingFlow.id, name: "Qualified", sort_order: 1 })
      makeFlowEdge(biddingLead, biddingQualified)
      // Drawn both directions from the start — one test below loops a deal
      // back to Lead, and issue #83 means an edge drawn AFTER a deal
      // registers is never picked up by that deal, so it has to exist here.
      makeFlowEdge(biddingQualified, biddingLead)

      outright = makeSaleType({ name: "Outright" })
      const outrightFlow = makeSalesFlow({ sale_type_id: outright.id })
      outrightLead = makeFlowStage({ flow_id: outrightFlow.id, name: "Enquiry", sort_order: 0 })

      // Issue #83 — registering (createOpportunity) or adopting
      // (updateSaleType) against either flow needs a locked snapshot to
      // exist; neither flow's live state changes again after this point in
      // any test here, so snapshotting once, last, is enough.
      makeFlowSnapshot({ flow_id: biddingFlow.id })
      makeFlowSnapshot({ flow_id: outrightFlow.id })
    })

    const register = () =>
      opportunityService.createOpportunity(payload({ sale_type_id: bidding.id }), registrar.id)

    it("re-routes a deal that has not moved yet, landing it on the new flow's first Stage", async () => {
      // No cross-flow Stage mapping exists, and private Stages make one
      // impossible, so the only correct destination is where deals start.
      const deal = await register()

      const changed = await opportunityService.updateSaleType(deal.id, outright.id, registrar.id)

      expect(changed.sale_type_id).toBe(outright.id)
      expect(changed.flow_stage_id).toBe(outrightLead.id)
    })

    it("logs the change with both the old and the new value", async () => {
      const deal = await register()
      await opportunityService.updateSaleType(deal.id, outright.id, registrar.id)

      const notes = await opportunityService.getNotes(deal.id)
      const change = notes.find((n) => n.metadata?.event === "SALE_TYPE_CHANGED")
      expect(change.content).toContain("Bidding")
      expect(change.content).toContain("Outright")
    })

    it("refuses once the deal has moved past its first Stage", async () => {
      const deal = await register()
      await opportunityService.updateStatus(deal.id, biddingQualified.id, registrar.id)

      await expect(
        opportunityService.updateSaleType(deal.id, outright.id, registrar.id),
      ).rejects.toThrow(/already moved/)
    })

    it("refuses to adopt a legacy deal that has already moved through the global pipeline", async () => {
      // A deal with no Sale Type has still moved: it has a position on the
      // global pipeline and a history behind it. Adopting it onto a flow
      // would land it on that flow's first Stage and throw both away.
      const legacy = await opportunityService.createOpportunity(payload(), registrar.id)
      await opportunityService.updateStatus(legacy.id, "QUALIFIED", registrar.id, { salesReference: "S01237" })

      await expect(
        opportunityService.updateSaleType(legacy.id, bidding.id, registrar.id),
      ).rejects.toThrow(/already moved/)
    })

    it("adopts a legacy deal that has never moved", async () => {
      // Still sitting where it was registered, so there is no position and no
      // history to lose. This is the path that migrates a fresh deal onto a
      // flow once the Operations Manager has drawn one.
      const legacy = await opportunityService.createOpportunity(payload(), registrar.id)

      const adopted = await opportunityService.updateSaleType(legacy.id, bidding.id, registrar.id)

      expect(adopted.sale_type_id).toBe(bidding.id)
      expect(adopted.flow_stage_id).toBe(biddingLead.id)
    })

    it("refuses even when a loop has brought the deal back to its first Stage", async () => {
      // Sitting on the entry Stage is not the same as never having left it:
      // the deal has a history in this flow that the other one cannot account
      // for.
      const deal = await register()
      await opportunityService.updateStatus(deal.id, biddingQualified.id, registrar.id)
      await opportunityService.updateStatus(deal.id, biddingLead.id, registrar.id, RESUME)

      await expect(
        opportunityService.updateSaleType(deal.id, outright.id, registrar.id),
      ).rejects.toThrow(/already moved/)
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
        'Company changed from "Quezon City Hall" to "Pasig City Hall"',
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

    // Issue #199 — a Stage Checklist Save sends one field. Every other part of
    // the SOR has to come back exactly as it was.
    describe("saving one field", () => {
      let closer, support1, support2, director

      const fullRecord = () => {
        closer = makeEmployee({ name: "Cara Lim" })
        support1 = makeEmployee({ name: "Dan Tan" })
        support2 = makeEmployee({ name: "Eve Go" })
        director = makeEmployee({ name: "Fe Uy" })
        return opportunityService.createOpportunity(
          payload({
            project_type: "STRATEGIC",
            sales_reference: "S04521",
            contact_person: "Engr. Santos",
            po_date: "2026-04-01",
            expected_award_date: "2026-05-01",
            lead_source_detail: "Mayor's office",
            closing_sales_id: closer.id,
            support_sales_1_id: support1.id,
            support_sales_2_id: support2.id,
            sales_director_id: director.id,
          }),
          registrar.id,
        )
      }

      const keptIntact = (found) => {
        expect(found).toMatchObject({
          deal_owner_id: owner.id,
          closing_sales_id: closer.id,
          support_sales_1_id: support1.id,
          support_sales_2_id: support2.id,
          sales_director_id: director.id,
          sales_reference: "S04521",
          contact_person: "Engr. Santos",
          expected_award_date: "2026-05-01",
          lead_source_detail: "Mayor's office",
          project_type: "STRATEGIC",
          client_name: "Quezon City Hall",
          expected_value: 3000,
        })
      }

      it("leaves the rest of the SOR intact when one real field is saved", async () => {
        const created = await fullRecord()

        await opportunityService.updateOpportunity(created.id, { po_date: "2026-04-09" }, registrar.id)

        const found = await opportunityService.getOpportunityById(created.id)
        keptIntact(found)
        expect(found.po_date).toBe("2026-04-09")
        const items = await opportunityService.getItems(created.id)
        expect(items.map((i) => i.product_name)).toEqual(["Pumper"])
      })

      it("records only the field that changed on the timeline", async () => {
        const created = await fullRecord()

        await opportunityService.updateOpportunity(created.id, { contact_person: "Engr. Cruz" }, registrar.id)

        const note = (await opportunityService.getNotes(created.id)).at(-1)
        expect(note.metadata.changes).toEqual([
          'Contact Person changed from "Engr. Santos" to "Engr. Cruz"',
        ])
      })

      it("still clears a field sent explicitly empty, and empties the Product List when sent empty", async () => {
        const created = await fullRecord()

        await opportunityService.updateOpportunity(
          created.id,
          { contact_person: "", closing_sales_id: null, items: [] },
          registrar.id,
        )

        const found = await opportunityService.getOpportunityById(created.id)
        expect(found.contact_person).toBeNull()
        expect(found.closing_sales_id).toBeNull()
        expect(found.expected_value).toBe(0)
        expect(await opportunityService.getItems(created.id)).toEqual([])
      })

      it("writes a real SOR field to its column through the single-field write", async () => {
        const created = await fullRecord()

        const saved = await opportunityService.saveRecordField(created.id, "po_date", "2026-04-20", registrar.id)

        expect(saved.po_date).toBe("2026-04-20")
        expect(saved.metadata?.po_date).toBeUndefined()
        keptIntact(saved)
      })

      it("merges a custom field into the stored metadata, keeping the others", async () => {
        const created = await opportunityService.createOpportunity(
          payload({ metadata: { "Bid bond": "BB-1" } }),
          registrar.id,
        )

        const saved = await opportunityService.saveRecordField(created.id, "Warranty", "2 years", registrar.id)

        expect(saved.metadata).toEqual({ "Bid bond": "BB-1", Warranty: "2 years" })
        expect(saved.deal_owner_id).toBe(owner.id)
        expect(saved.expected_value).toBe(3000)
      })

      it("offers a Save input for text, date and custom fields, but not people or Estimated Value", () => {
        const writable = ["po_date", "sales_reference", "Warranty", "supplier_id"].filter(opportunityService.isChecklistWritableField)
        const refused = ["deal_owner_id", "sales_director_id", "expected_value"].filter(opportunityService.isChecklistWritableField)
        expect(writable).toEqual(["po_date", "sales_reference", "Warranty", "supplier_id"])
        expect(refused).toEqual([])
      })

      it("refuses a malformed Sales Reference with a readable message", async () => {
        const created = await fullRecord()

        await expect(
          opportunityService.saveRecordField(created.id, "sales_reference", "nope", registrar.id),
        ).rejects.toThrow(/Odoo quotation number/)
      })
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

  describe("the SOR's tasks (#299)", () => {
    // The Now tab's one-line rows show parts done and a due date. Both come
    // from columns this query has to ask for: a row built from a select that
    // omits them still renders, just as "0/N" with no date, forever.
    it("carries each group member's status and the group task's due date", async () => {
      const deal = makeOpportunity()
      const [done, pending] = [makeEmployee(), makeEmployee()]
      const group = makeGroupTask({ opportunity_id: deal.id, due_date: "2026-09-30T00:00:00.000Z" })
      db.seed("committee_task_members", { committee_task_id: group.id, employee_id: done.id, task_description: "Site survey", status: "DONE" })
      db.seed("committee_task_members", { committee_task_id: group.id, employee_id: pending.id, task_description: "BOQ", status: "PENDING" })

      const { groupTasks } = await opportunityService.getAutomationTasks(deal.id)

      expect(groupTasks).toHaveLength(1)
      expect(groupTasks[0].due_date).toBe("2026-09-30T00:00:00.000Z")
      expect(groupTasks[0].members.map((m) => m.status).sort()).toEqual(["DONE", "PENDING"])
    })

    it("carries an individual task's due date", async () => {
      const deal = makeOpportunity()
      makeTask({ opportunity_id: deal.id, end_at: "2026-10-02T09:00:00.000Z" })

      const { individualTasks } = await opportunityService.getAutomationTasks(deal.id)

      expect(individualTasks).toHaveLength(1)
      expect(individualTasks[0].end_at).toBe("2026-10-02T09:00:00.000Z")
    })

    // Now shows only the current Stage Visit's tasks, decided by the same
    // stamp-or-window rule as the Journey — which needs both columns.
    it("carries what decides which Stage Visit a task belongs to", async () => {
      const deal = makeOpportunity()
      const visit = makeStageVisit({ opportunity_id: deal.id })
      makeTask({ opportunity_id: deal.id, stage_visit_id: visit.id })
      makeGroupTask({ opportunity_id: deal.id, stage_visit_id: visit.id })

      const { individualTasks, groupTasks } = await opportunityService.getAutomationTasks(deal.id)

      for (const task of [...individualTasks, ...groupTasks]) {
        expect(task.stage_visit_id).toBe(visit.id)
        expect(task.created_at).toEqual(expect.any(String))
      }
    })

    it("returns the current Stage Visit's window, or null for a deal with none", async () => {
      const deal = makeOpportunity()
      makeStageVisit({ opportunity_id: deal.id, sequence: 1, entered_at: "2026-01-01T00:00:00.000Z", left_at: "2026-01-10T00:00:00.000Z" })
      const open = makeStageVisit({ opportunity_id: deal.id, sequence: 2, entered_at: "2026-01-10T00:00:00.000Z" })

      expect(await opportunityService.getCurrentStageVisit(deal.id)).toEqual({
        id: open.id,
        enteredAt: "2026-01-10T00:00:00.000Z",
        leftAt: null,
      })
      expect(await opportunityService.getCurrentStageVisit(makeOpportunity().id)).toBeNull()
    })
  })

  describe("the Journey (#300)", () => {
    // Three visits with fixed windows: Lead, then Qualified, then back to
    // Lead — the loop is what makes per-visit evidence observable.
    let deal, lead, qualified, v1, v2, v3, estimator, creator

    beforeEach(() => {
      const flow = makeSalesFlow({ sale_type_id: makeSaleType().id })
      lead = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
      qualified = makeFlowStage({ flow_id: flow.id, name: "Qualified", sort_order: 1 })
      estimator = makeEmployee({ name: "Estimator" })
      creator = makeEmployee({ name: "Group Creator" })
      makeStageCondition({ stage_id: lead.id, kind: "tickbox", label: "Signed NDA" })
      makeStageCondition({
        stage_id: qualified.id,
        kind: "assignment",
        label: "Estimator assigned",
        config: { who: [{ type: "employee", id: estimator.id }] },
      })
      const snapshot = makeFlowSnapshot({ flow_id: flow.id })
      // No flow_stage_id: the visit trigger would open a sequence-1 visit of
      // its own on insert, and these windows need to be stated exactly.
      deal = makeOpportunity({ flow_snapshot_id: snapshot.id })

      v1 = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: lead.id, flow_snapshot_id: snapshot.id, sequence: 1, entered_at: "2026-01-01T00:00:00.000Z", left_at: "2026-01-10T00:00:00.000Z" })
      v2 = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: qualified.id, flow_snapshot_id: snapshot.id, sequence: 2, entered_at: "2026-01-10T00:00:00.000Z", left_at: "2026-01-20T00:00:00.000Z" })
      v3 = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: lead.id, flow_snapshot_id: snapshot.id, sequence: 3, entered_at: "2026-01-20T00:00:00.000Z" })

      // #296: getJourney asks sor_visible_visit_ids which of this deal's
      // visits are restricted for the caller. None of these tests are about
      // restriction, so the stub names every visit visible — the fake store
      // has no Postgres function to fall back on.
      stubRpc("sor_visible_visit_ids", (args) => {
        expect(args).toMatchObject({ p_opportunity_id: deal.id })
        return [v1.id, v2.id, v3.id]
      })
    })

    it("lists every visit latest first, named from the SOR's own snapshot", async () => {
      const journey = await opportunityService.getJourney(deal.id)

      expect(journey.map((v) => v.id)).toEqual([v3.id, v2.id, v1.id])
      expect(journey.map((v) => v.stage.name)).toEqual(["Lead", "Qualified", "Lead"])
      expect(journey[0]).toMatchObject({ leftAt: null, requestedItems: [] })
    })

    it("judges a tickbox per visit, so a loop back asks again", async () => {
      const [nda] = (await opportunityService.getJourney(deal.id))[2].conditions
      makeConditionStatus({ opportunity_id: deal.id, condition_id: nda.condition.id, stage_visit_id: v1.id })

      const [current, , first] = await opportunityService.getJourney(deal.id)

      expect(first.conditions[0].status).toBe("satisfied")
      expect(current.conditions[0].status).toBe("unsatisfied")
    })

    it("judges a closed visit on what existed when it closed, not on what was added since", async () => {
      makeOpportunityMember({ opportunity_id: deal.id, employee_id: estimator.id, added_at: "2026-01-25T00:00:00.000Z" })

      const qualifiedVisit = (await opportunityService.getJourney(deal.id))[1]

      expect(qualifiedVisit.conditions[0].condition.label).toBe("Estimator assigned")
      expect(qualifiedVisit.conditions[0].status).toBe("unsatisfied")
    })

    it("scopes tasks by their visit stamp, falling back to when an unstamped task was created", async () => {
      const stamped = makeTask({ opportunity_id: deal.id, stage_visit_id: v2.id, created_at: "2026-01-05T00:00:00.000Z" })
      const unstampedInV2 = makeTask({ opportunity_id: deal.id, created_at: "2026-01-12T00:00:00.000Z" })
      const unstampedInV3 = makeTask({ opportunity_id: deal.id, created_at: "2026-01-22T00:00:00.000Z" })
      makeGroupTask({ opportunity_id: deal.id, stage_visit_id: v3.id, created_by: creator.id })

      const [current, qualifiedVisit, first] = await opportunityService.getJourney(deal.id)

      expect(qualifiedVisit.tasks.map((t) => t.id).sort()).toEqual([stamped.id, unstampedInV2.id].sort())
      expect(current.tasks.map((t) => t.id)).toEqual([unstampedInV3.id])
      expect(first.tasks).toEqual([])
      expect(current.groupTasks[0].creator).toMatchObject({ id: creator.id, name: "Group Creator" })
    })

    it("returns attachments with resolved uploader", async () => {
      const file = {
        url: "https://res.cloudinary.test/bidding.pdf",
        name: "bidding.pdf",
        type: "pdf",
        bytes: 2048,
        stageVisitId: v2.id,
      }
      await opportunityService.addNote(deal.id, creator.id, "Bidding docs uploaded", [file])

      const [, qualifiedVisit] = await opportunityService.getJourney(deal.id)
      expect(qualifiedVisit.attachments).toHaveLength(1)
      expect(qualifiedVisit.attachments[0]).toMatchObject({
        name: "bidding.pdf",
        url: "https://res.cloudinary.test/bidding.pdf",
        uploader: expect.objectContaining({ id: creator.id, name: "Group Creator" }),
      })
    })
  })

  describe("notes", () => {
    it("notifies the person named in a note", async () => {
      // OPPORTUNITY_MENTION is one of the four types #168 pushes to a closed
      // tab, so it is sent via the send-push edge function.
      const pushed = []
      stubEdgeFunction("send-push", (body) => {
        pushed.push(body)
        return { success: true }
      })

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
      const [sent] = pushed
      expect(sent).toMatchObject({
        recipient_id: buyer.id,
        // No "TASK" substring: notificationRouter's fallthrough would send them
        // to the task pages instead of the deal being discussed.
        type: "OPPORTUNITY_MENTION",
        reference_id: opportunity.id,
      })
    })

    describe("ADR 0021 / #295 — visit-scoped mention notifications", () => {
      it("notifies a mentioned employee who is in sor_visit_audience for the open visit", async () => {
        const flowSaleType = makeSaleType({ name: "Flow for mentions" })
        const flowStage = makeFlowStage({ name: "Lead" })
        const opportunity = makeOpportunity({ registered_by: registrar.id, sale_type_id: flowSaleType.id })
        const visit = makeStageVisit({ opportunity_id: opportunity.id, flow_stage_id: flowStage.id })
        const buyer = makeEmployee({ name: "Cjay Espina" })

        // OPPORTUNITY_MENTION is a push-only type (#168) — it never lands a
        // row in `notifications`, so the assertion has to be on the push
        // edge function, same as "notifies the person named in a note" above.
        const pushed = []
        stubEdgeFunction("send-push", (body) => {
          pushed.push(body)
          return { success: true }
        })

        stubRpc("sor_visit_audience", (args) => {
          expect(args).toMatchObject({ p_opportunity_id: opportunity.id, p_visit_id: visit.id })
          return [buyer.id]
        })

        await opportunityService.addNote(
          opportunity.id,
          registrar.id,
          "@Cjay Espina can you check stock on this",
          [],
          [{ id: buyer.id, name: "Cjay Espina" }],
        )
        await waitForNetworkIdle()

        expect(pushed).toHaveLength(1)
        expect(pushed[0]).toMatchObject({ recipient_id: buyer.id, type: "OPPORTUNITY_MENTION" })
      })

      it("does not notify a mentioned employee who sor_visit_audience excludes — a mention grants nothing", async () => {
        const flowSaleType = makeSaleType({ name: "Flow for mentions 2" })
        const flowStage = makeFlowStage({ name: "Lead" })
        const opportunity = makeOpportunity({ registered_by: registrar.id, sale_type_id: flowSaleType.id })
        const visit = makeStageVisit({ opportunity_id: opportunity.id, flow_stage_id: flowStage.id })
        // Picked from the composer's roster before their access window closed,
        // or added to the note text by hand — either way, sor_visit_audience
        // no longer names them for this visit.
        const outOfWindow = makeEmployee({ name: "Cjay Espina" })

        const pushed = []
        stubEdgeFunction("send-push", (body) => {
          pushed.push(body)
          return { success: true }
        })

        stubRpc("sor_visit_audience", (args) => {
          expect(args).toMatchObject({ p_opportunity_id: opportunity.id, p_visit_id: visit.id })
          return []
        })

        await opportunityService.addNote(
          opportunity.id,
          registrar.id,
          "@Cjay Espina can you check stock on this",
          [],
          [{ id: outOfWindow.id, name: "Cjay Espina" }],
        )
        await waitForNetworkIdle()

        expect(pushed).toHaveLength(0)
        expect(db.rows("notifications")).toHaveLength(0)
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

    // Issue #206 — the Deleted view needs who and when, not just the flag.
    it("stamps who deleted it and when", async () => {
      const opportunity = makeOpportunity({ registered_by: registrar.id })

      const before = new Date().toISOString()
      await opportunityService.deleteOpportunity(opportunity.id, registrar.id)

      const stored = db.rows("sales_opportunities").find((o) => o.id === opportunity.id)
      expect(stored.deleted_by).toBe(registrar.id)
      expect(stored.deleted_at >= before).toBe(true)
    })
  })

  describe("the Deleted view (issue #206)", () => {
    let superAdmin, otherPerson

    beforeEach(() => {
      superAdmin = makeSuperAdmin()
      otherPerson = makeEmployee({ name: "Uninvolved Person" })
    })

    it("shows a Super Admin every deleted, non-scratch SOR", async () => {
      const mine = makeOpportunity({ registered_by: registrar.id, deal_owner_id: owner.id })
      const someoneElses = makeOpportunity({ registered_by: otherPerson.id })
      await opportunityService.deleteOpportunity(mine.id, registrar.id)
      await opportunityService.deleteOpportunity(someoneElses.id, otherPerson.id)

      const deleted = await opportunityService.getDeletedOpportunities(superAdmin.id, { isSuperAdmin: true })

      expect(deleted.map((o) => o.id).sort()).toEqual([mine.id, someoneElses.id].sort())
    })

    it("shows a Deal Owner or registrar only their own deleted SORs", async () => {
      const mine = makeOpportunity({ registered_by: registrar.id, deal_owner_id: owner.id })
      const someoneElses = makeOpportunity({ registered_by: otherPerson.id })
      await opportunityService.deleteOpportunity(mine.id, registrar.id)
      await opportunityService.deleteOpportunity(someoneElses.id, otherPerson.id)

      const asOwner = await opportunityService.getDeletedOpportunities(owner.id, { isSuperAdmin: false })
      expect(asOwner.map((o) => o.id)).toEqual([mine.id])

      const asRegistrar = await opportunityService.getDeletedOpportunities(registrar.id, { isSuperAdmin: false })
      expect(asRegistrar.map((o) => o.id)).toEqual([mine.id])

      const stranger = makeEmployee({ name: "Nobody's SOR" })
      const asStranger = await opportunityService.getDeletedOpportunities(stranger.id, { isSuperAdmin: false })
      expect(asStranger).toEqual([])
    })

    it("never lists a live SOR", async () => {
      makeOpportunity({ registered_by: registrar.id })

      const deleted = await opportunityService.getDeletedOpportunities(registrar.id, { isSuperAdmin: true })

      expect(deleted).toEqual([])
    })

    describe("restoring", () => {
      it("lets a Super Admin restore, clearing the delete stamp", async () => {
        const opportunity = makeOpportunity({ registered_by: registrar.id, deal_owner_id: owner.id })
        await opportunityService.deleteOpportunity(opportunity.id, registrar.id)

        const restored = await opportunityService.restoreOpportunity(opportunity.id, superAdmin.id)

        expect(restored.is_deleted).toBe(false)
        const stored = db.rows("sales_opportunities").find((o) => o.id === opportunity.id)
        expect(stored.deleted_at).toBeNull()
        expect(stored.deleted_by).toBeNull()
      })

      it("lets the SOR's own Deal Owner restore it", async () => {
        const opportunity = makeOpportunity({ registered_by: registrar.id, deal_owner_id: owner.id })
        await opportunityService.deleteOpportunity(opportunity.id, registrar.id)

        const restored = await opportunityService.restoreOpportunity(opportunity.id, owner.id)

        expect(restored.is_deleted).toBe(false)
      })

      it("refuses everyone else, including the registrar who isn't the Deal Owner", async () => {
        const opportunity = makeOpportunity({ registered_by: registrar.id, deal_owner_id: owner.id })
        await opportunityService.deleteOpportunity(opportunity.id, registrar.id)

        await expect(
          opportunityService.restoreOpportunity(opportunity.id, registrar.id),
        ).rejects.toThrow(/Super Admin or this SOR's Deal Owner/i)

        const stored = db.rows("sales_opportunities").find((o) => o.id === opportunity.id)
        expect(stored.is_deleted).toBe(true)
      })

      it("records the restore on the timeline and audit log", async () => {
        const opportunity = makeOpportunity({ registered_by: registrar.id, deal_owner_id: owner.id })
        await opportunityService.deleteOpportunity(opportunity.id, registrar.id)

        await opportunityService.restoreOpportunity(opportunity.id, owner.id)
        await waitForNetworkIdle()

        const notes = await opportunityService.getNotes(opportunity.id)
        expect(notes.some((n) => n.metadata?.event === "OPPORTUNITY_RESTORED")).toBe(true)
        expect(
          db.rows("system_audit_logs").some((e) => e.content.includes("restored")),
        ).toBe(true)
      })
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

/**
 * My SORs (Workspace of work, Sales nav) — ADR 0021 left a Stage Participant
 * able to open a deal and unable to find it: `sor_read` is Deal Team or
 * Always-sees only, so the SORS register structurally cannot list one. This
 * is the list that can.
 */
describe("getMySors", () => {
  let me, stageA, stageB, deal

  beforeEach(() => {
    me = makeEmployee({ name: "Techie Tina" })
    const saleType = makeSaleType({ name: "Government" })
    const flow = makeSalesFlow({ sale_type_id: saleType.id })
    stageA = makeFlowStage({ flow_id: flow.id, name: "Technical Review" })
    stageB = makeFlowStage({ flow_id: flow.id, name: "Bid Submitted" })
    // No flow_stage_id: the insert trigger would record visit sequence 1 and
    // collide with the visits these tests place by hand.
    deal = makeOpportunity({ sale_type_id: saleType.id })
    stubRpc("sor_locked_summary", () => [
      {
        sales_reference: "S01234",
        project_title: "Supply of Equipment",
        current_stage_name: "Bid Submitted",
        is_restricted: false,
      },
    ])
  })

  it("lists a deal the person was called into, naming the Stage that called them", async () => {
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: stageA.id, sequence: 1 })
    makeStageParticipant({
      opportunity_id: deal.id,
      employee_id: me.id,
      opened_visit_id: visit.id,
      until_rule: "stage_left",
    })

    const rows = await opportunityService.getMySors(me.id)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      opportunityId: deal.id,
      salesReference: "S01234",
      projectTitle: "Supply of Equipment",
      currentStageName: "Bid Submitted",
      isOpen: true,
    })
    // The Stage that pulled them in, not the Stage the deal is on now.
    expect(rows[0].windows[0]).toMatchObject({
      calledInAtStageName: "Technical Review",
      untilRule: "stage_left",
    })
  })

  it("names the later Stage a window reaches through", async () => {
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: stageA.id, sequence: 1 })
    makeStageParticipant({
      opportunity_id: deal.id,
      employee_id: me.id,
      opened_visit_id: visit.id,
      until_rule: "later_stage_left",
      until_stage_id: stageB.id,
    })

    const rows = await opportunityService.getMySors(me.id)

    expect(rows[0].windows[0]).toMatchObject({
      untilRule: "later_stage_left",
      untilStageName: "Bid Submitted",
    })
  })

  it("keeps two call-ins on one deal as two windows under one row", async () => {
    // CONTEXT.md: each call-in opens its own window, and one person named by
    // two actions holds two at once. The screen must not silently merge them.
    const visitA = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: stageA.id, sequence: 1 })
    const visitB = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: stageB.id, sequence: 2 })
    makeStageParticipant({ opportunity_id: deal.id, employee_id: me.id, opened_visit_id: visitA.id })
    makeStageParticipant({ opportunity_id: deal.id, employee_id: me.id, opened_visit_id: visitB.id, source: "assignment" })

    const rows = await opportunityService.getMySors(me.id)

    expect(rows).toHaveLength(1)
    expect(rows[0].windows).toHaveLength(2)
  })

  it("still lists a deal whose window has closed, marked closed", async () => {
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: stageA.id, sequence: 1 })
    makeStageParticipant({
      opportunity_id: deal.id,
      employee_id: me.id,
      opened_visit_id: visit.id,
      closed_at: new Date().toISOString(),
      closed_reason: "stage_left",
    })

    const rows = await opportunityService.getMySors(me.id)

    expect(rows).toHaveLength(1)
    expect(rows[0].isOpen).toBe(false)
  })

  it("a deal with one open and one closed window counts as open", async () => {
    const visit = makeStageVisit({ opportunity_id: deal.id, flow_stage_id: stageA.id, sequence: 1 })
    makeStageParticipant({ opportunity_id: deal.id, employee_id: me.id, opened_visit_id: visit.id, closed_at: new Date().toISOString() })
    makeStageParticipant({ opportunity_id: deal.id, employee_id: me.id, opened_visit_id: visit.id, source: "assignment" })

    const rows = await opportunityService.getMySors(me.id)

    expect(rows[0].isOpen).toBe(true)
  })

  it("lists nothing for someone who was never called in", async () => {
    const stranger = makeEmployee({ name: "Nobody Nina" })
    expect(await opportunityService.getMySors(stranger.id)).toEqual([])
  })

  it("asks for nothing without an employee", async () => {
    expect(await opportunityService.getMySors(null)).toEqual([])
  })
})

/**
 * A task's SOR link (#199) resolves its label through `sor_link_label`
 * — a SECURITY DEFINER RPC, not a raw table select — because `sor_read` has
 * no Stage Participant clause and a plain participant reading the table
 * directly gets zero rows back.
 */
describe("getOpportunityLinkLabel", () => {
  it("asks the RPC for the label, not the table directly", async () => {
    const deal = makeOpportunity({ sales_reference: "S99001", client_name: "Acme Corp" })
    stubRpc("sor_link_label", (args) => {
      expect(args).toEqual({ p_opportunity_id: deal.id })
      return "S99001"
    })

    expect(await opportunityService.getOpportunityLinkLabel(deal.id)).toBe("S99001")
  })

  it("asks for nothing without an id", async () => {
    expect(await opportunityService.getOpportunityLinkLabel(null)).toBeNull()
  })
})
