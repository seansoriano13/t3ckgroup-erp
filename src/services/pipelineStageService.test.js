import { describe, expect, it } from "vitest"
import { pipelineStageService } from "./pipelineStageService"
import { REALIZED_STAGES, realizedStageCodes } from "@/constants/sor"
import { makePipelineStage } from "@/test/factories"

/**
 * The pipeline moved from hard-coded constants into a table, and the service
 * keeps the twelve Annex C.3 stages as a fallback so the SOR Register can
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

    it("falls back to the policy pipeline when the table is empty", async () => {
      const stages = await pipelineStageService.getAllStages()

      expect(stages.map((s) => s.code)).toEqual([
        "LEAD",
        "QUALIFIED",
        "PROPOSAL_SUBMITTED",
        "BID_SUBMITTED",
        "NEGOTIATION",
        "AWARDED",
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
