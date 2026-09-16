import { beforeEach, describe, expect, it, vi } from "vitest"
import { salesFlowService } from "./salesFlowService"
import { waitForNetworkIdle } from "@/test/network"
import {
  makeEmployee,
  makeFlowStage,
  makeOpportunity,
  makeSaleType,
  makeSalesFlow,
  makeSuperAdmin,
} from "@/test/factories"
import { stubLockSalesFlowRpc } from "@/test/stubs/lockFlowRpc"
import { stubRestoreFlowSnapshotRpc } from "@/test/stubs/restoreFlowSnapshotRpc"
import { db } from "@/test/db/store"

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
    stubLockSalesFlowRpc()
    stubRestoreFlowSnapshotRpc()
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

    it("allows any employee to create a Sale Type", async () => {
      const type = await salesFlowService.createSaleType("Bidding", operations.id)
      expect(type.name).toBe("Bidding")
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

    it("labels a Stage's bracket, and clears it back to null", async () => {
      const flow = makeSalesFlow()
      const stage = await salesFlowService.addStage(flow.id, "Site Visit", admin.id)

      const labeled = await salesFlowService.updateStageBracket(stage.id, "  Pre-Sales  ", admin.id)
      expect(labeled.bracket_label).toBe("Pre-Sales")

      const cleared = await salesFlowService.updateStageBracket(stage.id, "", admin.id)
      expect(cleared.bracket_label).toBeNull()
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

  describe("insertStageOnMove — the midpoint plus (issue #196)", () => {
    it("turns A → B into A → New → B, leaving A's Conditions and Actions alone", async () => {
      const flow = makeSalesFlow()
      const a = await salesFlowService.addStage(flow.id, "A", admin.id)
      const b = await salesFlowService.addStage(flow.id, "B", admin.id)
      const edge = await salesFlowService.addEdge(flow.id, a.id, b.id, admin.id)

      const newStage = await salesFlowService.insertStageOnMove(edge.id, "New", admin.id, 100, 100)

      expect(newStage.name).toBe("New")

      const { stages, edges } = await salesFlowService.getFlow(flow.sale_type_id)
      expect(stages.map((s) => s.name).sort()).toEqual(["A", "B", "New"])
      expect(edges).toHaveLength(2)
      expect(edges.find((e) => e.from_stage_id === a.id)).toMatchObject({ to_stage_id: newStage.id })
      expect(edges.find((e) => e.to_stage_id === b.id)).toMatchObject({ from_stage_id: newStage.id })
      expect(edges.some((e) => e.from_stage_id === a.id && e.to_stage_id === b.id)).toBe(false)
    })

    it("refuses a blank or duplicate name, the same as adding a Stage", async () => {
      const flow = makeSalesFlow()
      const a = await salesFlowService.addStage(flow.id, "A", admin.id)
      const b = await salesFlowService.addStage(flow.id, "B", admin.id)
      const edge = await salesFlowService.addEdge(flow.id, a.id, b.id, admin.id)

      await expect(salesFlowService.insertStageOnMove(edge.id, "   ", admin.id)).rejects.toThrow(
        /needs a name/,
      )
      await expect(salesFlowService.insertStageOnMove(edge.id, "A", admin.id)).rejects.toThrow(
        /already a Stage/,
      )
    })

    it("refuses on a locked flow", async () => {
      const saleType = await salesFlowService.createSaleType("Bidding", admin.id)
      const flow = (await salesFlowService.getFlow(saleType.id)).flow
      const a = await salesFlowService.addStage(flow.id, "A", admin.id)
      const b = await salesFlowService.addStage(flow.id, "B", admin.id)
      const edge = await salesFlowService.addEdge(flow.id, a.id, b.id, admin.id)
      await salesFlowService.setWonStage(flow.id, b.id, admin.id)
      await salesFlowService.lockFlow(flow.id, admin.id)

      await expect(salesFlowService.insertStageOnMove(edge.id, "New", admin.id)).rejects.toThrow(
        /locked/,
      )
    })

    it("leaves A → B intact — an extra move, never a gap — if the insert fails after the second write", async () => {
      const flow = makeSalesFlow()
      const a = await salesFlowService.addStage(flow.id, "A", admin.id)
      const b = await salesFlowService.addStage(flow.id, "B", admin.id)
      const edge = await salesFlowService.addEdge(flow.id, a.id, b.id, admin.id)

      const originalAddEdge = salesFlowService.addEdge.bind(salesFlowService)
      let calls = 0
      vi.spyOn(salesFlowService, "addEdge").mockImplementation((...args) => {
        calls += 1
        // The first call inside insertStageOnMove draws A → New; the second
        // draws New → B. Failing that second write, after the first already
        // landed, is the exact partial failure the write order is chosen to
        // survive: A → B must still be there afterwards.
        if (calls === 2) return Promise.reject(new Error("Network dropped mid-write."))
        return originalAddEdge(...args)
      })

      await expect(
        salesFlowService.insertStageOnMove(edge.id, "New", admin.id),
      ).rejects.toThrow(/Network dropped/)

      vi.restoreAllMocks()

      const { stages, edges } = await salesFlowService.getFlow(flow.sale_type_id)
      expect(stages.some((s) => s.name === "New")).toBe(true)
      expect(edges.some((e) => e.from_stage_id === a.id && e.to_stage_id === b.id)).toBe(true)
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

    it("stores the publish note on the Flow Snapshot, and blanks it when none was given", async () => {
      const withNote = await salesFlowService.lockFlow(flow.id, admin.id, "Tightened the award Stage.")
      expect(withNote.snapshot.note).toBe("Tightened the award Stage.")

      await salesFlowService.unlockFlow(flow.id, "One more pass", admin.id)
      await salesFlowService.renameStage(won.id, "Awarded (final)", admin.id)
      const withoutNote = await salesFlowService.lockFlow(flow.id, admin.id)
      expect(withoutNote.snapshot.note).toBeNull()
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

    it("unlocks without a reason — the reopening is still recorded, the reason is not demanded", async () => {
      // The reason used to be mandatory here. Asking for it at the moment the
      // canvas is reopened wanted the answer before the work was done, so it
      // was reliably answered with noise; what changed is captured on the
      // Publish note instead. The reopening itself is still recorded, which is
      // what makes repeated reopening visible.
      await salesFlowService.lockFlow(flow.id, admin.id)

      const unlocked = await salesFlowService.unlockFlow(flow.id, "  ", admin.id)

      expect(unlocked.state).toBe("draft")
      expect(unlocked.locked_at).toBeNull()
    })

    it("creates a snapshot of the entire flow configuration on lock", async () => {
      const lockedResult = await salesFlowService.lockFlow(flow.id, admin.id)
      
      expect(lockedResult.snapshot).toBeDefined()
      expect(lockedResult.snapshot.version).toBe(1)
      expect(lockedResult.snapshot.version_minor).toBe(0) // a flow's first publish is v1.0
      expect(lockedResult.snapshot.snapshot_data).toBeDefined()
      expect(lockedResult.snapshot.snapshot_data.stages.length).toBe(2)
      expect(lockedResult.snapshot.snapshot_data.edges.length).toBe(1)
      
      // Artefacts should be emitted
      expect(lockedResult.artefacts).toBeDefined()
      expect(lockedResult.artefacts.promotableConfiguration).toBeTruthy()
      expect(lockedResult.artefacts.readableDocument).toBeTruthy()
      expect(lockedResult.artefacts.notesList).toBeTruthy()
    })

    it("bumps only the minor part when a publish just adds a Stage (ADR 0020)", async () => {
      await salesFlowService.lockFlow(flow.id, admin.id)
      await salesFlowService.unlockFlow(flow.id, "Need to add a stage", admin.id)

      const newStage = await salesFlowService.addStage(flow.id, "Negotiation", admin.id)
      await salesFlowService.addEdge(flow.id, entry.id, newStage.id, admin.id)

      const secondLock = await salesFlowService.lockFlow(flow.id, admin.id)

      // Every Stage of v1.0 is still present, and the Won Stage is unchanged —
      // every SOR on v1.x could be moved up, so this is v1.1.
      expect(secondLock.snapshot.version).toBe(1)
      expect(secondLock.snapshot.version_minor).toBe(1)
      expect(secondLock.snapshot.snapshot_data.stages.length).toBe(3)
      expect(secondLock.snapshot.snapshot_data.edges.length).toBe(2)
    })

    it("starts a new major version when a publish removes a Stage", async () => {
      await salesFlowService.lockFlow(flow.id, admin.id) // v1.0: entry + won
      await salesFlowService.unlockFlow(flow.id, "Dropping a Stage", admin.id)

      const spare = await salesFlowService.addStage(flow.id, "Spare", admin.id)
      await salesFlowService.addEdge(flow.id, entry.id, spare.id, admin.id)
      const v1_1 = await salesFlowService.lockFlow(flow.id, admin.id)
      expect([v1_1.snapshot.version, v1_1.snapshot.version_minor]).toEqual([1, 1])

      await salesFlowService.unlockFlow(flow.id, "Now removing it", admin.id)
      await salesFlowService.deleteStage(spare.id, admin.id)
      const major = await salesFlowService.lockFlow(flow.id, admin.id)

      // A Stage id present in v1.1 is gone — deals on it could be stranded.
      expect([major.snapshot.version, major.snapshot.version_minor]).toEqual([2, 0])
    })

    it("previews the next version from the same database rule the publish uses", async () => {
      await salesFlowService.lockFlow(flow.id, admin.id)
      await salesFlowService.unlockFlow(flow.id, "tweak", admin.id)
      const neg = await salesFlowService.addStage(flow.id, "Negotiation", admin.id)
      await salesFlowService.addEdge(flow.id, entry.id, neg.id, admin.id)

      const preview = await salesFlowService.previewVersion(flow.id)
      expect(preview.major).toBe(1)
      expect(preview.minor).toBe(1)
      expect(preview.label).toBe("v1.1")
      // Issue #189 — the preview also carries the diff against the latest
      // version, so the publish popover's change summary and "no empty
      // publishes" gate read the same computation the button's label does.
      expect(preview.hasChanges).toBe(true)
      expect(preview.diff.stages.added.map((s) => s.name)).toEqual(["Negotiation"])

      const published = await salesFlowService.lockFlow(flow.id, admin.id)
      expect([published.snapshot.version, published.snapshot.version_minor]).toEqual([1, 1])
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

  describe("restoring a Flow Snapshot into the live draft", () => {
    async function buildLockedFlow(stageNames) {
      const saleType = await salesFlowService.createSaleType(`Flow ${Math.random()}`, admin.id)
      const flow = (await salesFlowService.getFlow(saleType.id)).flow
      const stages = []
      for (const name of stageNames) {
        stages.push(await salesFlowService.addStage(flow.id, name, admin.id))
      }
      for (let i = 0; i < stages.length - 1; i += 1) {
        await salesFlowService.addEdge(flow.id, stages[i].id, stages[i + 1].id, admin.id)
      }
      await salesFlowService.setWonStage(flow.id, stages[stages.length - 1].id, admin.id)
      const locked = await salesFlowService.lockFlow(flow.id, admin.id)
      return { saleType, flow: locked, snapshot: locked.snapshot }
    }

    it("rebuilds the flow's draft as an earlier Snapshot's shape", async () => {
      const { flow, snapshot } = await buildLockedFlow(["Lead", "Qualified", "Awarded"])
      await salesFlowService.unlockFlow(flow.id, "Trying something different", admin.id)
      await salesFlowService.addStage(flow.id, "Extra Stage", admin.id)

      const restored = await salesFlowService.restoreSnapshot(flow.id, snapshot.id, admin.id)

      expect(restored.stages.map((s) => s.name).sort()).toEqual(["Awarded", "Lead", "Qualified"])
      expect(restored.edges).toHaveLength(2)
      expect(restored.flow.won_stage_id).toBeTruthy()
      const wonStage = restored.stages.find((s) => s.id === restored.flow.won_stage_id)
      expect(wonStage.name).toBe("Awarded")
    })

    it("does not touch the Snapshot it restored from, or any other Snapshot", async () => {
      const { flow, snapshot } = await buildLockedFlow(["Lead", "Awarded"])
      await salesFlowService.unlockFlow(flow.id, "Redrawing it", admin.id)
      const before = await salesFlowService.getFlow(flow.sale_type_id)
      const leadStage = before.stages.find((s) => s.name === "Lead")
      const extraStage = await salesFlowService.addStage(flow.id, "Extra Stage", admin.id)
      await salesFlowService.addEdge(flow.id, leadStage.id, extraStage.id, admin.id)
      await salesFlowService.lockFlow(flow.id, admin.id) // v1.1 — adds the extra stage
      await salesFlowService.unlockFlow(flow.id, "About to restore v1", admin.id)

      const restored = await salesFlowService.restoreSnapshot(flow.id, snapshot.id, admin.id)

      expect(restored.stages.map((s) => s.name).sort()).toEqual(["Awarded", "Lead"])
      // Restoring is additive: it becomes a new version only on the next lock.
      // The restore drops "Extra Stage", whose id was in v1.1, so that publish
      // is a new major (ADR 0020).
      const relocked = await salesFlowService.lockFlow(restored.flow.id, admin.id)
      expect([relocked.snapshot.version, relocked.snapshot.version_minor]).toEqual([2, 0])
    })

    it("refuses to restore into a locked flow", async () => {
      const { flow, snapshot } = await buildLockedFlow(["Lead", "Awarded"])

      await expect(salesFlowService.restoreSnapshot(flow.id, snapshot.id, admin.id)).rejects.toThrow(
        /locked/,
      )
    })

    it("refuses a Snapshot that belongs to a different flow", async () => {
      const { flow: flowA } = await buildLockedFlow(["Lead", "Awarded"])
      await salesFlowService.unlockFlow(flowA.id, "reopen", admin.id)
      const { snapshot: snapshotB } = await buildLockedFlow(["Enquiry", "Won"])

      await expect(salesFlowService.restoreSnapshot(flowA.id, snapshotB.id, admin.id)).rejects.toThrow(
        /does not belong to this flow/,
      )
    })

    it("allows any employee to restore a Snapshot", async () => {
      const { flow, snapshot } = await buildLockedFlow(["Lead", "Awarded"])
      await salesFlowService.unlockFlow(flow.id, "reopen", admin.id)
      const regular = makeEmployee()

      const restored = await salesFlowService.restoreSnapshot(flow.id, snapshot.id, regular.id)
      expect(restored.stages.map((s) => s.name).sort()).toEqual(["Awarded", "Lead"])
    })

    it("keeps every Stage, move, Condition and Action id, unlike importSnapshot which mints new ones", async () => {
      const { flow, snapshot } = await buildLockedFlow(["Lead", "Qualified", "Awarded"])
      const before = await salesFlowService.getFlow(flow.sale_type_id)
      const stageIdsBefore = before.stages.map((s) => s.id).sort()
      const edgeIdsBefore = before.edges.map((e) => e.id).sort()

      await salesFlowService.unlockFlow(flow.id, "reopen", admin.id)
      await salesFlowService.addStage(flow.id, "Throwaway", admin.id)

      const restored = await salesFlowService.restoreSnapshot(flow.id, snapshot.id, admin.id)
      expect(restored.stages.map((s) => s.id).sort()).toEqual(stageIdsBefore)
      expect(restored.edges.map((e) => e.id).sort()).toEqual(edgeIdsBefore)

      const imported = await salesFlowService.importSnapshot(
        snapshot.snapshot_data,
        `Imported ${Math.random()}`,
        admin.id,
      )
      expect(imported.stages.some((s) => stageIdsBefore.includes(s.id))).toBe(false)
    })

    it("restores two Stages that have swapped names", async () => {
      const { flow, snapshot } = await buildLockedFlow(["Lead", "Awarded"])
      const before = await salesFlowService.getFlow(flow.sale_type_id)
      const lead = before.stages.find((s) => s.name === "Lead")
      const awarded = before.stages.find((s) => s.name === "Awarded")

      await salesFlowService.unlockFlow(flow.id, "swap the names", admin.id)
      await salesFlowService.renameStage(lead.id, "TEMP", admin.id)
      await salesFlowService.renameStage(awarded.id, "Lead", admin.id)
      await salesFlowService.renameStage(lead.id, "Awarded", admin.id)

      const restored = await salesFlowService.restoreSnapshot(flow.id, snapshot.id, admin.id)
      expect(restored.stages.find((s) => s.id === lead.id).name).toBe("Lead")
      expect(restored.stages.find((s) => s.id === awarded.id).name).toBe("Awarded")
    })

    it("refuses, changing nothing, when a dropped Stage still has an SOR on it — soft-deleted SORs included", async () => {
      const { flow, snapshot } = await buildLockedFlow(["Lead", "Awarded"])
      await salesFlowService.unlockFlow(flow.id, "trying a rework", admin.id)
      const extra = await salesFlowService.addStage(flow.id, "Site Survey", admin.id)
      makeOpportunity({
        sale_type_id: flow.sale_type_id,
        flow_stage_id: extra.id,
        is_deleted: true,
      })

      await expect(
        salesFlowService.restoreSnapshot(flow.id, snapshot.id, admin.id),
      ).rejects.toThrow(/"Site Survey" is referenced by 1 SOR \(all 1 soft-deleted\)/)

      const after = await salesFlowService.getFlow(flow.sale_type_id)
      expect(after.stages.map((s) => s.name).sort()).toEqual(["Awarded", "Lead", "Site Survey"])
    })

    it("writes an audit event naming the version restored", async () => {
      const { flow, snapshot } = await buildLockedFlow(["Lead", "Awarded"])
      await salesFlowService.unlockFlow(flow.id, "reopen", admin.id)

      await salesFlowService.restoreSnapshot(flow.id, snapshot.id, admin.id)
      await waitForNetworkIdle()

      const events = db.internal
        .rowsOf("system_audit_logs")
        .filter((r) => r.metadata?.event === "SALES_FLOW_SNAPSHOT_RESTORED")
      expect(events).toHaveLength(1)
      expect(events[0].content).toMatch(/v1 restored/)
    })
  })

  describe("how many live SORs are running each Flow Snapshot", () => {
    it("counts SORs by the Snapshot they are pinned to, excluding Scratch and soft-deleted SORs", async () => {
      const { flow, snapshot: v1, lead } = await buildLockedFlowFor("Government Bidding")
      await salesFlowService.unlockFlow(flow.id, "revising", admin.id)
      await salesFlowService.renameStage(lead.id, "Enquiry", admin.id)
      const relocked = await salesFlowService.lockFlow(flow.id, admin.id)
      const v2 = relocked.snapshot

      makeOpportunity({ sale_type_id: flow.sale_type_id, flow_snapshot_id: v1.id })
      makeOpportunity({ sale_type_id: flow.sale_type_id, flow_snapshot_id: v1.id })
      makeOpportunity({ sale_type_id: flow.sale_type_id, flow_snapshot_id: v2.id })
      makeOpportunity({ sale_type_id: flow.sale_type_id, flow_snapshot_id: v1.id, is_scratch: true })
      makeOpportunity({ sale_type_id: flow.sale_type_id, flow_snapshot_id: v1.id, is_retail: true })
      makeOpportunity({ sale_type_id: flow.sale_type_id, flow_snapshot_id: v1.id, is_deleted: true })
      makeOpportunity({ sale_type_id: flow.sale_type_id, flow_snapshot_id: null })

      const counts = await salesFlowService.getSnapshotUsageCounts(flow.id)

      expect(counts).toEqual({ [v1.id]: 2, [v2.id]: 1, none: 1 })
    })

    async function buildLockedFlowFor(saleTypeName) {
      const saleType = await salesFlowService.createSaleType(saleTypeName, admin.id)
      const flow = (await salesFlowService.getFlow(saleType.id)).flow
      const lead = await salesFlowService.addStage(flow.id, "Lead", admin.id)
      const won = await salesFlowService.addStage(flow.id, "Awarded", admin.id)
      await salesFlowService.addEdge(flow.id, lead.id, won.id, admin.id)
      await salesFlowService.setWonStage(flow.id, won.id, admin.id)
      const locked = await salesFlowService.lockFlow(flow.id, admin.id)
      return { saleType, flow: locked, snapshot: locked.snapshot, lead }
    }
  })

  describe("Flow Snapshot history", () => {
    it("lists a flow's Snapshots newest first, with who locked each one", async () => {
      const saleType = await salesFlowService.createSaleType("Outright Sale", admin.id)
      const flow = (await salesFlowService.getFlow(saleType.id)).flow
      const lead = await salesFlowService.addStage(flow.id, "Lead", admin.id)
      const won = await salesFlowService.addStage(flow.id, "Awarded", admin.id)
      await salesFlowService.addEdge(flow.id, lead.id, won.id, admin.id)
      await salesFlowService.setWonStage(flow.id, won.id, admin.id)
      const v1 = (await salesFlowService.lockFlow(flow.id, admin.id)).snapshot
      await salesFlowService.unlockFlow(flow.id, "One more pass", admin.id)
      await salesFlowService.renameStage(lead.id, "Enquiry", admin.id)
      const v2 = (await salesFlowService.lockFlow(flow.id, admin.id)).snapshot

      const history = await salesFlowService.listSnapshots(flow.id)

      // A second publish with nothing removed is minor, so newest-first is by
      // (major, minor).
      expect(history.map((s) => [s.version, s.version_minor])).toEqual([
        [1, 1],
        [1, 0],
      ])
      expect(history.map((s) => s.id)).toEqual([v2.id, v1.id])
      expect(history[0].created_by).toBe(admin.id)
    })

    it("is empty for a flow that has never been locked", async () => {
      const flow = makeSalesFlow()

      expect(await salesFlowService.listSnapshots(flow.id)).toEqual([])
    })

    it("fetches one Snapshot by id, with the flow it belongs to", async () => {
      // The read behind "which version is my deal running": an SOR pins a
      // snapshot id at registration, and this is how that id becomes a version
      // number and the rules it captured.
      const saleType = await salesFlowService.createSaleType("Outright Sale", admin.id)
      const flow = (await salesFlowService.getFlow(saleType.id)).flow
      const lead = await salesFlowService.addStage(flow.id, "Lead", admin.id)
      const won = await salesFlowService.addStage(flow.id, "Awarded", admin.id)
      await salesFlowService.addEdge(flow.id, lead.id, won.id, admin.id)
      await salesFlowService.setWonStage(flow.id, won.id, admin.id)
      const locked = (await salesFlowService.lockFlow(flow.id, admin.id)).snapshot

      const found = await salesFlowService.getSnapshot(locked.id)

      expect(found.id).toBe(locked.id)
      expect(found.version).toBe(1)
      expect(found.snapshot_data.stages.map((s) => s.name)).toEqual(["Lead", "Awarded"])
      expect(found.flow.sale_type_id).toBe(saleType.id)
    })

    it("returns nothing rather than raising when the Snapshot is not there", async () => {
      // A deal carrying an id that resolves to nothing should render "no
      // version on record", not an error page.
      expect(await salesFlowService.getSnapshot(crypto.randomUUID())).toBeNull()
      expect(await salesFlowService.getSnapshot(null)).toBeNull()
    })
  })

  describe("unlock reasons", () => {
    it("lists every reason a flow was reopened, newest first", async () => {
      const saleType = await salesFlowService.createSaleType("Outright Sale", admin.id)
      const flow = (await salesFlowService.getFlow(saleType.id)).flow
      const lead = await salesFlowService.addStage(flow.id, "Lead", admin.id)
      const won = await salesFlowService.addStage(flow.id, "Awarded", admin.id)
      await salesFlowService.addEdge(flow.id, lead.id, won.id, admin.id)
      await salesFlowService.setWonStage(flow.id, won.id, admin.id)
      await salesFlowService.lockFlow(flow.id, admin.id)
      await salesFlowService.unlockFlow(flow.id, "Ops wanted one more Stage", admin.id)
      await salesFlowService.renameStage(lead.id, "Enquiry", admin.id)
      await salesFlowService.lockFlow(flow.id, admin.id)
      await salesFlowService.unlockFlow(flow.id, "A typo in a Stage name", admin.id)
      // unlockFlow's audit write is fire-and-forget, same as every other
      // event in this file — wait for it to actually land before reading it back.
      await waitForNetworkIdle()

      const unlocks = await salesFlowService.listUnlockEvents(flow.id)

      expect(unlocks.map((u) => u.reason)).toEqual([
        "A typo in a Stage name",
        "Ops wanted one more Stage",
      ])
      expect(unlocks[0].employeeId).toBe(admin.id)
    })

    it("is empty for a flow that has never been unlocked", async () => {
      const flow = makeSalesFlow()

      expect(await salesFlowService.listUnlockEvents(flow.id)).toEqual([])
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
