import { describe, expect, it } from "vitest"

import {
  BRACKET_H,
  BRACKET_PAD_X,
  GATE,
  RUN,
  SAT_H,
  SAT_GAP_Y,
  SAT_VISIBLE,
  SAT_W,
  STAGE_H,
  STAGE_W,
  bracketBox,
  columnRows,
  columnSlots,
  satellitePosition,
  stageBox,
} from "./flowCanvasLayout"

describe("flowCanvasLayout", () => {
  describe("satellitePosition", () => {
    it("hangs conditions to the left and actions to the right of the Stage", () => {
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

    it("widens left for conditions and right for actions", () => {
      const gateOnly = stageBox({ conditionCount: 2 })
      const runOnly = stageBox({ actionCount: 2 })

      // The condition column sits left of the node, so the node's own origin
      // moves right inside the box; the action column adds width but no offset.
      expect(gateOnly.offsetX).toBeGreaterThan(0)
      expect(runOnly.offsetX).toBe(0)
      expect(gateOnly.width).toBeGreaterThan(STAGE_W)
      expect(runOnly.width).toBeGreaterThan(STAGE_W)
    })

    it("grows tall enough for the longer of the two columns", () => {
      const short = stageBox({ conditionCount: 1, actionCount: 1 })
      const tall = stageBox({ conditionCount: 1, actionCount: 3 })
      expect(tall.height).toBeGreaterThan(short.height)
      expect(tall.height).toBe(stageBox({ conditionCount: 3, actionCount: 1 }).height)
    })

    it("reserves room for the overflow node, not just the drawn items", () => {
      const capped = stageBox({ conditionCount: SAT_VISIBLE })
      const overflowing = stageBox({ conditionCount: SAT_VISIBLE + 9 })
      // Nine extra conditions collapse into one node — one extra row, no more.
      expect(overflowing.height).toBe(capped.height + SAT_H + SAT_GAP_Y)
    })
  })

  describe("bracketBox", () => {
    it("spans from the leftmost Stage's left edge to the rightmost Stage's right edge", () => {
      const box = bracketBox([{ pos_x: 100, pos_y: 0 }, { pos_x: 500, pos_y: 0 }])
      expect(box.x).toBe(100 - BRACKET_PAD_X)
      expect(box.width).toBe(500 + STAGE_W - 100 + BRACKET_PAD_X * 2)
    })

    it("sits just above the topmost member, regardless of how the rest are scattered", () => {
      const box = bracketBox([{ pos_x: 0, pos_y: 300 }, { pos_x: 200, pos_y: 40 }, { pos_x: 400, pos_y: 900 }])
      expect(box.y).toBe(40 - BRACKET_H)
    })

    it("still spans correctly for a single-member bracket", () => {
      const box = bracketBox([{ pos_x: 50, pos_y: 20 }])
      expect(box.x).toBe(50 - BRACKET_PAD_X)
      expect(box.width).toBe(STAGE_W + BRACKET_PAD_X * 2)
      expect(box.y).toBe(20 - BRACKET_H)
    })
  })
})
