import { describe, expect, it } from "vitest"

import {
  BRACKET_H,
  BRACKET_PAD_X,
  FIELDS,
  GATE,
  RUN,
  SAT_H,
  SAT_GAP_Y,
  SAT_VISIBLE,
  SAT_W,
  STAGE_H,
  STAGE_W,
  bracketBox,
  bracketNode,
  bracketRuns,
  byCanvasPosition,
  columnRows,
  columnSlots,
  midpointStagePosition,
  nextStagePosition,
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

    it("makes room below for fields without widening the Stage", () => {
      const bare = stageBox()
      const withFields = stageBox({ fieldCount: 2 })

      // The Fields column sits centred under the node, narrower than it — so a
      // Stage that only has fields is taller, never wider, and never shifts.
      expect(withFields.width).toBe(bare.width)
      expect(withFields.offsetX).toBe(0)
      expect(withFields.height).toBeGreaterThan(bare.height)
    })

    it("grows to the longest of all three columns", () => {
      expect(stageBox({ fieldCount: 3, conditionCount: 1, actionCount: 1 }).height).toBe(
        stageBox({ conditionCount: 3 }).height,
      )
    })

    it("reserves room for the overflow node, not just the drawn items", () => {
      const capped = stageBox({ conditionCount: SAT_VISIBLE })
      const overflowing = stageBox({ conditionCount: SAT_VISIBLE + 9 })
      // Nine extra conditions collapse into one node — one extra row, no more.
      expect(overflowing.height).toBe(capped.height + SAT_H + SAT_GAP_Y)
    })
  })

  describe("satellitePosition", () => {
    it("hangs fields straight under the Stage, between the conditions and the actions", () => {
      const fields = satellitePosition(FIELDS, 0)

      expect(fields.x).toBe((STAGE_W - SAT_W) / 2)
      expect(fields.x).toBeGreaterThan(satellitePosition(GATE, 0).x + SAT_W)
      expect(fields.x + SAT_W).toBeLessThan(satellitePosition(RUN, 0).x)
      expect(fields.y).toBe(satellitePosition(GATE, 0).y)
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

  describe("byCanvasPosition", () => {
    it("orders by pos_x, then pos_y to break a tie", () => {
      const stages = [
        { id: "c", pos_x: 200, pos_y: 0 },
        { id: "a", pos_x: 100, pos_y: 50 },
        { id: "b", pos_x: 100, pos_y: 10 },
      ]
      expect([...stages].sort(byCanvasPosition).map((s) => s.id)).toEqual(["b", "a", "c"])
    })

    it("treats a missing position as zero", () => {
      const stages = [{ id: "x", pos_x: 5 }, { id: "y" }]
      expect([...stages].sort(byCanvasPosition).map((s) => s.id)).toEqual(["y", "x"])
    })
  })

  describe("bracketRuns", () => {
    it("groups a consecutive run sharing a label into one run", () => {
      const runs = bracketRuns([
        { id: "a", pos_x: 0, bracket_label: "Pre-Sales" },
        { id: "b", pos_x: 100, bracket_label: "Pre-Sales" },
        { id: "c", pos_x: 200, bracket_label: null },
      ])
      expect(runs).toHaveLength(2)
      expect(runs[0]).toMatchObject({ label: "Pre-Sales" })
      expect(runs[0].stages.map((s) => s.id)).toEqual(["a", "b"])
      expect(runs[1]).toMatchObject({ label: null })
    })

    it("splits a label reused past an intervening Stage into two runs", () => {
      const runs = bracketRuns([
        { id: "a", pos_x: 0, bracket_label: "Closing" },
        { id: "b", pos_x: 100, bracket_label: "Delivery" },
        { id: "c", pos_x: 200, bracket_label: "Closing" },
      ])
      expect(runs.map((r) => r.label)).toEqual(["Closing", "Delivery", "Closing"])
      expect(runs[0].stages.map((s) => s.id)).toEqual(["a"])
      expect(runs[2].stages.map((s) => s.id)).toEqual(["c"])
    })

    it("groups by canvas order, not array order", () => {
      const runs = bracketRuns([
        { id: "c", pos_x: 200, bracket_label: "Ops" },
        { id: "a", pos_x: 0, bracket_label: "Ops" },
        { id: "b", pos_x: 100, bracket_label: "Ops" },
      ])
      expect(runs).toHaveLength(1)
      expect(runs[0].stages.map((s) => s.id)).toEqual(["a", "b", "c"])
    })

    it("treats an empty-string label as unlabeled", () => {
      const runs = bracketRuns([{ id: "a", pos_x: 0, bracket_label: "" }])
      expect(runs[0].label).toBeNull()
    })

    it("returns nothing for no Stages", () => {
      expect(bracketRuns([])).toEqual([])
    })
  })

  describe("bracketNode", () => {
    const run = {
      label: "Pre-Sales",
      stages: [{ id: "a", pos_x: 100, pos_y: 0 }, { id: "b", pos_x: 500, pos_y: 0 }],
    }

    it("ids the node by label and its run's first Stage, so a split label stays unique", () => {
      expect(bracketNode(run).id).toBe("bracket:Pre-Sales:a")
      expect(bracketNode({ ...run, stages: [{ id: "c", pos_x: 900 }] }).id).toBe("bracket:Pre-Sales:c")
    })

    it("spans its run's Stages and carries the label to the brace", () => {
      const node = bracketNode(run)
      expect(node.data).toEqual({ label: "Pre-Sales", width: bracketBox(run.stages).width })
      expect(node.position).toEqual({ x: bracketBox(run.stages).x, y: bracketBox(run.stages).y })
    })

    it("is an inert annotation behind every real node", () => {
      const node = bracketNode(run)
      expect(node.zIndex).toBe(-1)
      expect(node.selectable).toBe(false)
      expect(node.draggable).toBe(false)
      expect(node.style.pointerEvents).toBe("none")
    })
  })

  describe("nextStagePosition (issue #195)", () => {
    it("places the new Stage to the right of its source", () => {
      const source = { pos_x: 100, pos_y: 150 }
      const pos = nextStagePosition(source, [source])
      expect(pos.x).toBe(100 + STAGE_W + 96)
      expect(pos.y).toBe(150)
    })

    it("nudges down until it overlaps no existing Stage", () => {
      const source = { pos_x: 100, pos_y: 100 }
      const targetX = 100 + STAGE_W + 96
      // Put an existing stage exactly where the default placement would land
      const existing = [source, { pos_x: targetX, pos_y: 100 }]
      const pos = nextStagePosition(source, existing)
      expect(pos.x).toBe(targetX)
      expect(pos.y).toBe(100 + STAGE_H + 24)
    })

    it("stacks multiple consecutive children downward without collision", () => {
      const source = { pos_x: 0, pos_y: 0 }
      const firstChild = { pos_x: STAGE_W + 96, pos_y: 0 }
      const secondChildPos = nextStagePosition(source, [source, firstChild])
      expect(secondChildPos.x).toBe(STAGE_W + 96)
      expect(secondChildPos.y).toBe(STAGE_H + 24)

      const secondChild = { pos_x: secondChildPos.x, pos_y: secondChildPos.y }
      const thirdChildPos = nextStagePosition(source, [source, firstChild, secondChild])
      expect(thirdChildPos.x).toBe(STAGE_W + 96)
      expect(thirdChildPos.y).toBe((STAGE_H + 24) * 2)
    })
  })

  describe("midpointStagePosition (issue #196)", () => {
    it("places the new Stage halfway between the move's two ends", () => {
      // The two ends are a clear STAGE_H apart vertically: the midpoint of a
      // shallower move lands inside the source's own box once a Stage is tall
      // enough, and then the nudge below — not the halving — decides where it
      // goes, which is a different rule than the one under test here.
      const source = { pos_x: 0, pos_y: 0 }
      const target = { pos_x: 400, pos_y: 600 }
      const pos = midpointStagePosition(source, target, [source, target])
      expect(pos).toEqual({ x: 200, y: 300 })
    })

    it("nudges down until it overlaps no existing Stage", () => {
      const source = { pos_x: 0, pos_y: 100 }
      const target = { pos_x: 400, pos_y: 100 }
      const occupyingMidpoint = { pos_x: 200, pos_y: 100 }
      const pos = midpointStagePosition(source, target, [source, target, occupyingMidpoint])
      expect(pos.x).toBe(200)
      expect(pos.y).toBe(100 + STAGE_H + 24)
    })
  })
})
