import { describe, expect, it } from "vitest"
import { pipelineStageService } from "./pipelineStageService"
import { REALIZED_STAGES, realizedStageCodes } from "@/constants/sor"
import { makePipelineStage } from "@/test/factories"

/**
 * The pipeline moved from hard-coded constants into a table, and the service
 * keeps the default stage list as a fallback so the SOR Register can
 * never render an empty board — a pipeline with no stages is not a degraded
 * register, it is no register at all.
 */
describe("pipelineStageService", () => {
  describe("reading the pipeline", () => {
    it("returns the configured stages in pipeline order, not insertion order", async () => {
      makePipelineStage({ code: "THIRD", sort_order: 30 })
      makePipelineStage({ code: "FIRST", sort_order: 10 })
      makePipelineStage({ code: "SECOND", sort_order: 20 })

      const stages = await pipelineStageService.getAllStages()

      expect(stages.map((s) => s.code)).toEqual(["FIRST", "SECOND", "THIRD"])
    })

    it("falls back to the default pipeline when the table is empty", async () => {
      const stages = await pipelineStageService.getAllStages()

      expect(stages.map((s) => s.code)).toEqual([
        "LEAD",
        "PROPOSAL_SUBMITTED",
        "QUALIFIED",
        "FOR_BIDDING",
        "BID_SUBMITTED",
        "NEGOTIATION",
        "AWARDED",
        "PAYMENT_VERIFICATION",
        "PO_RECEIVED",
        "PROJECT_DELIVERY",
        "COLLECTION",
        "CLOSED_WON",
        "RETENTION",
        "CLOSED_LOST",
      ])
    })

    it("offers only active stages to a picker", async () => {
      makePipelineStage({ code: "CURRENT", sort_order: 10, is_active: true })
      makePipelineStage({ code: "RETIRED", sort_order: 20, is_active: false })

      const active = await pipelineStageService.getActiveStages()

      expect(active.map((s) => s.code)).toEqual(["CURRENT"])
    })

    it("keeps a deactivated stage visible to the admin screen", async () => {
      makePipelineStage({ code: "CURRENT", sort_order: 10, is_active: true })
      makePipelineStage({ code: "RETIRED", sort_order: 20, is_active: false })

      const all = await pipelineStageService.getAllStages()

      // An opportunity may still be sitting in the retired stage, and the
      // register has to be able to render its badge.
      expect(all.map((s) => s.code)).toEqual(["CURRENT", "RETIRED"])
    })

    it("falls back rather than returning nothing when every stage is deactivated", async () => {
      makePipelineStage({ code: "RETIRED", sort_order: 10, is_active: false })

      const active = await pipelineStageService.getActiveStages()

      expect(active.length).toBeGreaterThan(0)
      expect(active.map((s) => s.code)).toContain("LEAD")
    })
  })

  describe("the flags that carry meaning", () => {
    it("seeds exactly one entry, anchor, won and lost stage", async () => {
      const stages = await pipelineStageService.getAllStages()
      const only = (flag) => stages.filter((s) => s[flag]).map((s) => s.code)

      expect(only("is_default")).toEqual(["LEAD"])
      expect(only("is_anchor")).toEqual(["AWARDED"])
      expect(only("is_won")).toEqual(["CLOSED_WON"])
      expect(only("is_lost")).toEqual(["CLOSED_LOST"])
    })

    it("marks the whole fallback pipeline as system-owned", async () => {
      const stages = await pipelineStageService.getAllStages()

      // Nothing seeded by policy may be retired from a settings screen.
      expect(stages.every((s) => s.is_system)).toBe(true)
    })

    it("classifies the fallback pipeline into the same Realized set as policy", async () => {
      const stages = await pipelineStageService.getAllStages()

      expect(realizedStageCodes(stages)).toEqual(REALIZED_STAGES)
    })
  })

  describe("reordering stages", () => {
    it("swaps two adjacent stages' positions without colliding on sort_order", async () => {
      // A super admin clicking the up/down arrow swaps exactly two rows'
      // sort_order values. Writing both in one batch collides with the unique
      // index the moment either row is applied before the other, because for
      // an instant each still holds the OTHER row's old value.
      makePipelineStage({ code: "A", sort_order: 20 })
      makePipelineStage({ code: "B", sort_order: 30 })

      await pipelineStageService.reorderStages([
        { code: "A", sort_order: 30 },
        { code: "B", sort_order: 20 },
      ])

      const stages = await pipelineStageService.getAllStages()
      expect(stages.find((s) => s.code === "A").sort_order).toBe(30)
      expect(stages.find((s) => s.code === "B").sort_order).toBe(20)
    })

    it("swaps regardless of which row the caller lists first", async () => {
      makePipelineStage({ code: "A", sort_order: 20 })
      makePipelineStage({ code: "B", sort_order: 30 })

      await pipelineStageService.reorderStages([
        { code: "B", sort_order: 20 },
        { code: "A", sort_order: 30 },
      ])

      const stages = await pipelineStageService.getAllStages()
      expect(stages.find((s) => s.code === "A").sort_order).toBe(30)
      expect(stages.find((s) => s.code === "B").sort_order).toBe(20)
    })

    it("reorders more than two stages in one call without colliding", async () => {
      makePipelineStage({ code: "A", sort_order: 10 })
      makePipelineStage({ code: "B", sort_order: 20 })
      makePipelineStage({ code: "C", sort_order: 30 })

      // A full rotation: every target value is currently held by another row
      // in the batch, the worst case for a naive single-pass write.
      await pipelineStageService.reorderStages([
        { code: "A", sort_order: 20 },
        { code: "B", sort_order: 30 },
        { code: "C", sort_order: 10 },
      ])

      const stages = await pipelineStageService.getAllStages()
      expect(stages.find((s) => s.code === "A").sort_order).toBe(20)
      expect(stages.find((s) => s.code === "B").sort_order).toBe(30)
      expect(stages.find((s) => s.code === "C").sort_order).toBe(10)
    })

    it("leaves every other stage's position untouched", async () => {
      makePipelineStage({ code: "A", sort_order: 20 })
      makePipelineStage({ code: "B", sort_order: 30 })
      makePipelineStage({ code: "UNTOUCHED", sort_order: 40 })

      await pipelineStageService.reorderStages([
        { code: "A", sort_order: 30 },
        { code: "B", sort_order: 20 },
      ])

      const stages = await pipelineStageService.getAllStages()
      expect(stages.find((s) => s.code === "UNTOUCHED").sort_order).toBe(40)
    })
  })

  describe("deactivating a stage", () => {
    it("deactivates an ordinary open-region stage", async () => {
      makePipelineStage({ code: "AWARDED", sort_order: 60, is_anchor: true })
      makePipelineStage({ code: "QUALIFIED", sort_order: 20, is_active: true })

      const updated = await pipelineStageService.toggleStage("QUALIFIED", false)

      expect(updated.is_active).toBe(false)
    })

    it("refuses to deactivate the entry stage", async () => {
      makePipelineStage({ code: "AWARDED", sort_order: 60, is_anchor: true })
      makePipelineStage({ code: "LEAD", sort_order: 10, is_default: true })

      await expect(pipelineStageService.toggleStage("LEAD", false)).rejects.toThrow(/Lead/i)
    })

    it("refuses to deactivate the Anchor Stage", async () => {
      makePipelineStage({ code: "AWARDED", sort_order: 60, is_anchor: true })

      await expect(pipelineStageService.toggleStage("AWARDED", false)).rejects.toThrow(/Anchor/i)
    })

    it("refuses to deactivate the won stage", async () => {
      makePipelineStage({ code: "AWARDED", sort_order: 60, is_anchor: true })
      makePipelineStage({ code: "CLOSED_WON", sort_order: 100, is_won: true })

      await expect(pipelineStageService.toggleStage("CLOSED_WON", false)).rejects.toThrow(/Won/i)
    })

    it("refuses to deactivate the lost stage", async () => {
      makePipelineStage({ code: "AWARDED", sort_order: 60, is_anchor: true })
      makePipelineStage({ code: "CLOSED_LOST", sort_order: 120, is_lost: true })

      await expect(pipelineStageService.toggleStage("CLOSED_LOST", false)).rejects.toThrow(/Lost/i)
    })

    it("refuses to deactivate a stage past the Anchor Stage, even when none of the four flags are set", async () => {
      // The post-award accounting pipeline is meant to be entirely locked
      // (spec: "Deactivate: only unflagged open stages"). PO Received carries
      // none of is_default/is_anchor/is_won/is_lost, so only checking those
      // four lets an admin punch a hole in the middle of the pipeline the
      // commission engine and register both depend on.
      makePipelineStage({ code: "AWARDED", sort_order: 60, is_anchor: true })
      makePipelineStage({ code: "PO_RECEIVED", sort_order: 70 })

      await expect(pipelineStageService.toggleStage("PO_RECEIVED", false)).rejects.toThrow(
        /post-award|open region|past the anchor/i,
      )
    })

    it("reactivating a stage is always allowed, even one after the Anchor Stage", async () => {
      makePipelineStage({ code: "AWARDED", sort_order: 60, is_anchor: true })
      makePipelineStage({ code: "PO_RECEIVED", sort_order: 70, is_active: false })

      const updated = await pipelineStageService.toggleStage("PO_RECEIVED", true)

      expect(updated.is_active).toBe(true)
    })
  })

  describe("adding a stage", () => {
    it("refuses to insert at or after the Anchor Stage's position", async () => {
      makePipelineStage({ code: "AWARDED", sort_order: 60, is_anchor: true })

      await expect(
        pipelineStageService.addStage({ label: "Post-Award Step", theme: "amber", sort_order: 65 }),
      ).rejects.toThrow(/anchor/i)
    })

    it("adds a stage before the Anchor Stage", async () => {
      makePipelineStage({ code: "AWARDED", sort_order: 60, is_anchor: true })

      const created = await pipelineStageService.addStage({
        label: "Site Survey",
        theme: "amber",
        sort_order: 25,
      })

      expect(created.code).toBe("SITE_SURVEY")
      expect(created.is_active).toBe(true)
      expect(created.is_system).toBe(false)
    })

    it("rejects a label that collides with an existing stage's generated code", async () => {
      makePipelineStage({ code: "SITE_SURVEY", label: "Site Survey", sort_order: 25 })

      await expect(
        pipelineStageService.addStage({ label: "Site Survey", theme: "amber", sort_order: 26 }),
      ).rejects.toThrow(/already exists/i)
    })
  })

  describe("what the database refuses", () => {
    it("rejects a second stage claiming the same code", async () => {
      makePipelineStage({ code: "QUALIFIED", sort_order: 10 })

      expect(() => makePipelineStage({ code: "QUALIFIED", sort_order: 20 })).toThrow()
    })

    it("rejects two stages sharing a position in the pipeline", async () => {
      makePipelineStage({ code: "ONE", sort_order: 10 })

      expect(() => makePipelineStage({ code: "TWO", sort_order: 10 })).toThrow()
    })

    it("rejects a second anchor stage", async () => {
      // Two anchors would mean two different Contract Dates could be stamped,
      // and an opportunity priced by whichever it happened to pass through.
      makePipelineStage({ code: "ONE", sort_order: 10, is_anchor: true })

      expect(() =>
        makePipelineStage({ code: "TWO", sort_order: 20, is_anchor: true }),
      ).toThrow()
    })

    it("rejects a second entry, won or lost stage", async () => {
      makePipelineStage({ code: "A", sort_order: 10, is_default: true, is_won: true, is_lost: true })

      expect(() => makePipelineStage({ code: "B", sort_order: 20, is_default: true })).toThrow()
      expect(() => makePipelineStage({ code: "C", sort_order: 30, is_won: true })).toThrow()
      expect(() => makePipelineStage({ code: "D", sort_order: 40, is_lost: true })).toThrow()
    })
  })
})
