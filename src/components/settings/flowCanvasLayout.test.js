import { describe, expect, it } from "vitest"

import {
  GATE,
  RUN,
  SAT_H,
  SAT_GAP_Y,
  SAT_VISIBLE,
  SAT_W,
  STAGE_H,
  STAGE_W,
  columnRows,
  columnSlots,
  satellitePosition,
  stageBox,
} from "./flowCanvasLayout"

describe("flowCanvasLayout", () => {
  describe("satellitePosition", () => {
    it("hangs requirements to the left and actions to the right of the Stage", () => {
      expect(satellitePosition(GATE, 0).x).toBeLessThan(0)
      expect(satellitePosition(RUN, 0).x).toBeGreaterThanOrEqual(STAGE_W)
    })

    it("clears the Stage's own band, so a satellite never crosses the flow's edges", () => {
      expect(satellitePosition(GATE, 0).y).toBeGreaterThan(STAGE_H)
      expect(satellitePosition(RUN, 0).y).toBeGreaterThan(STAGE_H)
    })

    it("stacks each column downward at a fixed pitch", () => {
      const first = satellitePosition(GATE, 0)
      const second = satellitePosition(GATE, 1)
      expect(second.x).toBe(first.x)
      expect(second.y - first.y).toBe(SAT_H + SAT_GAP_Y)
    })

    it("keeps the two columns apart", () => {
      const gateRight = satellitePosition(GATE, 0).x + SAT_W
      expect(gateRight).toBeLessThanOrEqual(satellitePosition(RUN, 0).x)
    })
  })

  describe("columnSlots", () => {
    it("draws every item while the column is short enough", () => {
      expect(columnSlots(0)).toEqual({ shown: 0, overflow: 0 })
      expect(columnSlots(SAT_VISIBLE)).toEqual({ shown: SAT_VISIBLE, overflow: 0 })
    })

    it("folds the rest into an overflow rather than pushing neighbours off screen", () => {
      expect(columnSlots(SAT_VISIBLE + 3)).toEqual({ shown: SAT_VISIBLE, overflow: 3 })
    })

    it("counts the overflow node itself as a row", () => {
      expect(columnRows(SAT_VISIBLE)).toBe(SAT_VISIBLE)
      expect(columnRows(SAT_VISIBLE + 3)).toBe(SAT_VISIBLE + 1)
    })
  })

  describe("stageBox", () => {
    it("is exactly the node when the Stage has no satellites", () => {
      expect(stageBox()).toEqual({
        width: STAGE_W,
        height: STAGE_H,
        offsetX: 0,
        offsetY: 0,
      })
    })

    it("widens left for requirements and right for actions", () => {
      const gateOnly = stageBox({ requirementCount: 2 })
      const runOnly = stageBox({ actionCount: 2 })

      // The requirement column sits left of the node, so the node's own origin
      // moves right inside the box; the action column adds width but no offset.
      expect(gateOnly.offsetX).toBeGreaterThan(0)
      expect(runOnly.offsetX).toBe(0)
      expect(gateOnly.width).toBeGreaterThan(STAGE_W)
      expect(runOnly.width).toBeGreaterThan(STAGE_W)
    })

    it("grows tall enough for the longer of the two columns", () => {
      const short = stageBox({ requirementCount: 1, actionCount: 1 })
      const tall = stageBox({ requirementCount: 1, actionCount: 3 })
      expect(tall.height).toBeGreaterThan(short.height)
      expect(tall.height).toBe(stageBox({ requirementCount: 3, actionCount: 1 }).height)
    })

    it("reserves room for the overflow node, not just the drawn items", () => {
      const capped = stageBox({ requirementCount: SAT_VISIBLE })
      const overflowing = stageBox({ requirementCount: SAT_VISIBLE + 9 })
      // Nine extra requirements collapse into one node — one extra row, no more.
      expect(overflowing.height).toBe(capped.height + SAT_H + SAT_GAP_Y)
    })
  })
})
