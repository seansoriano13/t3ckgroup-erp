import { beforeEach, describe, expect, it } from "vitest"
import { salesFlowService } from "./salesFlowService"
import { makeEmployee, makeFlowStage, makeSaleType, makeSalesFlow, makeSuperAdmin } from "@/test/factories"

/**
 * The Flow Canvas's persistence layer (issue #36, ADR 0006). Tested against
 * the in-memory fake database, the same tier as stageConditionService and
 * pipelineStageService — the query shapes here are ones real PostgREST would
 * accept.
 *
 * What belongs in the pure module instead: whether a move is a legal edge,
 * where a deal enters, whether a flow may be locked. Those are
 * constants/salesFlow.js and are tested there, not through a database.
 */
describe("salesFlowService", () => {
  let admin
  let operations

  beforeEach(() => {
    admin = makeSuperAdmin({ name: "Super Admin" })
    operations = makeEmployee({ name: "Ops Manager" })
  })

  describe("Sale Types", () => {
    it("starts empty — the system proposes no Sale Types", async () => {
      // Issue #36's first user story. A seeded list would be the system
      // steering her toward categories that do not match how the business
      // sells, which is the failure this whole table exists to end.
      expect(await salesFlowService.getSaleTypes()).toEqual([])
    })

    it("creates a Sale Type with its own empty Sales Flow", async () => {
      const saleType = await salesFlowService.createSaleType("Government Bidding", admin.id)

      expect(saleType.name).toBe("Government Bidding")

      const flow = await salesFlowService.getFlow(saleType.id)
      expect(flow.saleType.id).toBe(saleType.id)
      expect(flow.flow.state).toBe("draft")
      expect(flow.stages).toEqual([])
      expect(flow.edges).toEqual([])
    })

    it("refuses a blank name", async () => {
      await expect(salesFlowService.createSaleType("   ", admin.id)).rejects.toThrow(/needs a name/)
    })

    it("refuses a second live Sale Type with the same name", async () => {
      await salesFlowService.createSaleType("Outright", admin.id)

      await expect(salesFlowService.createSaleType("  outright ", admin.id)).rejects.toThrow(
        /already a Sale Type called/,
      )
    })

    it("renames a Sale Type, because a working name is not a commitment", async () => {
      const saleType = await salesFlowService.createSaleType("Bidding", admin.id)

      const renamed = await salesFlowService.renameSaleType(saleType.id, "Government Bidding", admin.id)

      expect(renamed.name).toBe("Government Bidding")
    })

    it("lets an archived Sale Type's name be reused", async () => {
      // The archived one keeps its name — deals that carry it still read it —
      // and must not block the flow she is redrawing in its place.
      const first = await salesFlowService.createSaleType("Outright", admin.id)
      await salesFlowService.archiveSaleType(first.id, admin.id)

      const second = await salesFlowService.createSaleType("Outright", admin.id)

      expect(second.id).not.toBe(first.id)
      expect((await salesFlowService.getSaleTypes()).map((t) => t.id)).toEqual([second.id])
    })

    it("only a Super Admin may create a Sale Type", async () => {
      await expect(salesFlowService.createSaleType("Bidding", operations.id)).rejects.toThrow(
        /Only a Super Admin/,
      )
    })
  })

  describe("Stages private to a flow", () => {
    it("adds Stages to a flow in the order they were added", async () => {
      const saleType = await salesFlowService.createSaleType("Bidding", admin.id)
      const { flow } = await salesFlowService.getFlow(saleType.id)

      await salesFlowService.addStage(flow.id, "Lead", admin.id)
      await salesFlowService.addStage(flow.id, "Qualified", admin.id)

      const { stages } = await salesFlowService.getFlow(saleType.id)
      expect(stages.map((s) => s.name)).toEqual(["Lead", "Qualified"])
    })

    it("keeps two flows' Stages entirely separate", async () => {
      // ADR 0006 — two flows may each contain a Stage named "Proposal
      // Submitted" and they are unrelated rows. Editing one must be incapable
      // of touching the other.
      const bidding = await salesFlowService.createSaleType("Bidding", admin.id)
      const outright = await salesFlowService.createSaleType("Outright", admin.id)
      const biddingFlow = (await salesFlowService.getFlow(bidding.id)).flow
      const outrightFlow = (await salesFlowService.getFlow(outright.id)).flow

      const shared = await salesFlowService.addStage(biddingFlow.id, "Proposal Submitted", admin.id)
      await salesFlowService.addStage(outrightFlow.id, "Proposal Submitted", admin.id)

      await salesFlowService.renameStage(shared.id, "Bid Submitted", admin.id)

      expect((await salesFlowService.getFlow(bidding.id)).stages.map((s) => s.name)).toEqual(["Bid Submitted"])
      expect((await salesFlowService.getFlow(outright.id)).stages.map((s) => s.name)).toEqual([
        "Proposal Submitted",
      ])
    })

    it("refuses two Stages with the same name in one flow", async () => {
      const flow = makeSalesFlow()
      await salesFlowService.addStage(flow.id, "Awaiting Approval", admin.id)

      await expect(salesFlowService.addStage(flow.id, " awaiting approval ", admin.id)).rejects.toThrow(
        /already a Stage called/,
      )
    })

    it("reorders Stages, which is how she says where deals start", async () => {
      const flow = makeSalesFlow()
      const lead = await salesFlowService.addStage(flow.id, "Lead", admin.id)
      const qualified = await salesFlowService.addStage(flow.id, "Qualified", admin.id)

      await salesFlowService.reorderStages(flow.id, [qualified.id, lead.id], admin.id)

      const { stages } = await salesFlowService.getFlow(flow.sale_type_id)
      expect(stages.map((s) => s.name)).toEqual(["Qualified", "Lead"])
    })

    it("marks a Stage terminal, so the flow records where deals stop", async () => {
      const flow = makeSalesFlow()
      const lost = await salesFlowService.addStage(flow.id, "Lost", admin.id)

      await salesFlowService.setStageTerminal(lost.id, true, admin.id)

      const { stages } = await salesFlowService.getFlow(flow.sale_type_id)
      expect(stages.find((s) => s.id === lost.id).is_terminal).toBe(true)
    })

    it("deletes a Stage and every edge that touched it", async () => {
      const flow = makeSalesFlow()
      const lead = await salesFlowService.addStage(flow.id, "Lead", admin.id)
      const qualified = await salesFlowService.addStage(flow.id, "Qualified", admin.id)
      await salesFlowService.addEdge(flow.id, lead.id, qualified.id, admin.id)

      await salesFlowService.deleteStage(qualified.id, admin.id)

      const after = await salesFlowService.getFlow(flow.sale_type_id)
      expect(after.stages.map((s) => s.name)).toEqual(["Lead"])
      expect(after.edges).toEqual([])
    })

    it("refuses to delete the Stage the flow calls Won", async () => {
      // Losing the Won Stage by side effect would leave the flow unlockable
      // with no indication of why. She moves the designation first.
      const flow = makeSalesFlow()
      const won = await salesFlowService.addStage(flow.id, "Awarded", admin.id)
      await salesFlowService.setWonStage(flow.id, won.id, admin.id)

      await expect(salesFlowService.deleteStage(won.id, admin.id)).rejects.toThrow(/Won Stage/)
    })
  })

  describe("Edges", () => {
    it("draws a permitted move between two Stages", async () => {
      const flow = makeSalesFlow()
      const lead = await salesFlowService.addStage(flow.id, "Lead", admin.id)
      const qualified = await salesFlowService.addStage(flow.id, "Qualified", admin.id)

      await salesFlowService.addEdge(flow.id, lead.id, qualified.id, admin.id)

      const { edges } = await salesFlowService.getFlow(flow.sale_type_id)
      expect(edges).toHaveLength(1)
      expect(edges[0]).toMatchObject({ from_stage_id: lead.id, to_stage_id: qualified.id })
    })

    it("refuses an edge from a Stage to itself", async () => {
      const flow = makeSalesFlow()
      const lead = await salesFlowService.addStage(flow.id, "Lead", admin.id)

      await expect(salesFlowService.addEdge(flow.id, lead.id, lead.id, admin.id)).rejects.toThrow(
        /to itself/,
      )
    })

    it("refuses an edge whose endpoint belongs to another flow", async () => {
      // The coupling private Stages exist to prevent: an edge spanning two
      // flows would make one flow's move legal by way of another's.
      const flow = makeSalesFlow()
      const mine = await salesFlowService.addStage(flow.id, "Lead", admin.id)
      const theirs = makeFlowStage()

      await expect(salesFlowService.addEdge(flow.id, mine.id, theirs.id, admin.id)).rejects.toThrow(
        /same flow/,
      )
    })

    it("ignores an edge that was already drawn rather than duplicating it", async () => {
      const flow = makeSalesFlow()
      const lead = await salesFlowService.addStage(flow.id, "Lead", admin.id)
      const qualified = await salesFlowService.addStage(flow.id, "Qualified", admin.id)

      await salesFlowService.addEdge(flow.id, lead.id, qualified.id, admin.id)
      await salesFlowService.addEdge(flow.id, lead.id, qualified.id, admin.id)

      expect((await salesFlowService.getFlow(flow.sale_type_id)).edges).toHaveLength(1)
    })

    it("removes an edge she decided is not a real path", async () => {
      const flow = makeSalesFlow()
      const lead = await salesFlowService.addStage(flow.id, "Lead", admin.id)
      const qualified = await salesFlowService.addStage(flow.id, "Qualified", admin.id)
      const drawn = await salesFlowService.addEdge(flow.id, lead.id, qualified.id, admin.id)

      await salesFlowService.removeEdge(drawn.id, admin.id)

      expect((await salesFlowService.getFlow(flow.sale_type_id)).edges).toEqual([])
    })
  })

  describe("a locked flow is read-only", () => {
    let flow
    let entry
    let won

    beforeEach(async () => {
      const saleType = await salesFlowService.createSaleType("Bidding", admin.id)
      flow = (await salesFlowService.getFlow(saleType.id)).flow
      entry = await salesFlowService.addStage(flow.id, "Lead", admin.id)
      won = await salesFlowService.addStage(flow.id, "Awarded", admin.id)
      await salesFlowService.addEdge(flow.id, entry.id, won.id, admin.id)
      await salesFlowService.setWonStage(flow.id, won.id, admin.id)
    })

    it("refuses to lock a flow that is not fit to be locked", async () => {
      const other = makeSalesFlow()
      await salesFlowService.addStage(other.id, "Lead", admin.id)

      await expect(salesFlowService.lockFlow(other.id, admin.id)).rejects.toThrow(/no Won Stage/)
    })

    it("locks a flow once it has Stages, edges and a Won Stage", async () => {
      const locked = await salesFlowService.lockFlow(flow.id, admin.id)

      expect(locked.state).toBe("locked")
      expect(locked.locked_by).toBe(admin.id)
      expect(locked.locked_at).toBeTruthy()
    })

    it("refuses every edit once locked", async () => {
      await salesFlowService.lockFlow(flow.id, admin.id)

      await expect(salesFlowService.addStage(flow.id, "Negotiation", admin.id)).rejects.toThrow(/locked/)
      await expect(salesFlowService.renameStage(entry.id, "Enquiry", admin.id)).rejects.toThrow(/locked/)
      await expect(salesFlowService.deleteStage(entry.id, admin.id)).rejects.toThrow(/locked/)
      await expect(salesFlowService.addEdge(flow.id, won.id, entry.id, admin.id)).rejects.toThrow(/locked/)
    })

    it("unlocks with a reason, so repeated reopening is visible", async () => {
      await salesFlowService.lockFlow(flow.id, admin.id)

      const unlocked = await salesFlowService.unlockFlow(flow.id, "Ops corrected the award Stage", admin.id)

      expect(unlocked.state).toBe("draft")
      expect(unlocked.locked_at).toBeNull()
      await expect(salesFlowService.addStage(flow.id, "Negotiation", admin.id)).resolves.toBeTruthy()
    })

    it("refuses to unlock without a reason", async () => {
      await salesFlowService.lockFlow(flow.id, admin.id)

      await expect(salesFlowService.unlockFlow(flow.id, "  ", admin.id)).rejects.toThrow(/reason/)
    })

    it("creates a snapshot of the entire flow configuration on lock", async () => {
      const lockedResult = await salesFlowService.lockFlow(flow.id, admin.id)
      
      expect(lockedResult.snapshot).toBeDefined()
      expect(lockedResult.snapshot.version).toBe(1)
      expect(lockedResult.snapshot.snapshot_data).toBeDefined()
      expect(lockedResult.snapshot.snapshot_data.stages.length).toBe(2)
      expect(lockedResult.snapshot.snapshot_data.edges.length).toBe(1)
      
      // Artefacts should be emitted
      expect(lockedResult.artefacts).toBeDefined()
      expect(lockedResult.artefacts.promotableConfiguration).toBeTruthy()
      expect(lockedResult.artefacts.readableDocument).toBeTruthy()
      expect(lockedResult.artefacts.notesList).toBeTruthy()
    })

    it("creates a new snapshot version when locked again", async () => {
      await salesFlowService.lockFlow(flow.id, admin.id)
      await salesFlowService.unlockFlow(flow.id, "Need to add a stage", admin.id)
      
      const newStage = await salesFlowService.addStage(flow.id, "Negotiation", admin.id)
      await salesFlowService.addEdge(flow.id, entry.id, newStage.id, admin.id)
      
      const secondLock = await salesFlowService.lockFlow(flow.id, admin.id)
      
      expect(secondLock.snapshot.version).toBe(2)
      expect(secondLock.snapshot.snapshot_data.stages.length).toBe(3)
      expect(secondLock.snapshot.snapshot_data.edges.length).toBe(2)
    })
  })

  describe("importing a snapshot (promotion)", () => {
    it("creates a new Sale Type and Sales Flow from a snapshot", async () => {
      // First, create a flow and lock it to get a snapshot
      const sourceSaleType = await salesFlowService.createSaleType("Source Bidding", admin.id)
      const sourceFlow = (await salesFlowService.getFlow(sourceSaleType.id)).flow
      const lead = await salesFlowService.addStage(sourceFlow.id, "Lead", admin.id)
      const won = await salesFlowService.addStage(sourceFlow.id, "Awarded", admin.id)
      await salesFlowService.addEdge(sourceFlow.id, lead.id, won.id, admin.id)
      await salesFlowService.setWonStage(sourceFlow.id, won.id, admin.id)
      
      // We need stageActionService and stageConditionService in real tests, but for now we test structure
      
      const lockedResult = await salesFlowService.lockFlow(sourceFlow.id, admin.id)
      const snapshotData = lockedResult.snapshot.snapshot_data
      
      // Now import it
      const imported = await salesFlowService.importSnapshot(snapshotData, "Imported Bidding", admin.id)
      
      expect(imported.saleType.name).toBe("Imported Bidding")
      expect(imported.flow.state).toBe("draft") // imported flows start as draft
      expect(imported.stages.length).toBe(2)
      expect(imported.edges.length).toBe(1)
      expect(imported.flow.won_stage_id).toBeTruthy()
      
      // Ensure the IDs are new
      expect(imported.saleType.id).not.toBe(sourceSaleType.id)
      expect(imported.flow.id).not.toBe(sourceFlow.id)
      expect(imported.stages[0].id).not.toBe(lead.id)
    })
  })

  describe("reading Sale Types for a picker", () => {
    it("lists live Sale Types by name, leaving archived ones out", async () => {
      await salesFlowService.createSaleType("Outright", admin.id)
      await salesFlowService.createSaleType("Bidding", admin.id)
      const retired = await salesFlowService.createSaleType("Retired", admin.id)
      await salesFlowService.archiveSaleType(retired.id, admin.id)

      expect((await salesFlowService.getSaleTypes()).map((t) => t.name)).toEqual(["Bidding", "Outright"])
    })

    it("returns null for a Sale Type that does not exist rather than throwing", async () => {
      expect(await salesFlowService.getFlow(makeSaleType().id)).toBeNull()
    })
  })
})
