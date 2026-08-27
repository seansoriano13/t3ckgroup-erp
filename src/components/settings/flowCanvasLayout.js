/**
 * Flow Canvas geometry — pure arithmetic, no React and no React Flow.
 *
 * A Stage on the canvas is not one box. It is a Stage node with two columns of
 * satellites hanging off it: the conditions that gate a deal on the way out,
 * and the actions that fire on the way in. Every consumer of that shape needs
 * the same numbers — the node builder places the satellites, auto-layout has to
 * reserve room for them, and neither may disagree with the other about where a
 * Stage actually ends. So the numbers live here, once.
 *
 * Prior art: constants/salesFlow.js ↔ salesFlow.test.js — the graph's own
 * questions are answered by a pure module rather than inside a component.
 *
 * Coordinates: a satellite's position is relative to its Stage node's top-left,
 * which is what React Flow wants from a child node (`parentId`). Conditions
 * hang below-left, actions below-right, and both start below the Stage's own
 * band so they never cross the horizontal edges of the flow itself.
 */

export const STAGE_W = 264
export const STAGE_H = 96

export const SAT_W = 184
export const SAT_H = 56
export const SAT_GAP_Y = 8

/** Vertical drop from the Stage's bottom edge to the first satellite. */
export const SAT_DROP = 56
/** Horizontal gap between the Stage's side and its satellite column. */
export const SAT_GAP_X = 32

/**
 * Satellites shown per column before the rest collapse into one "+N more" node.
 * A Stage with fourteen conditions is a Stage whose gate is read in the panel,
 * not on the canvas; drawing all fourteen would push its neighbours off screen.
 */
export const SAT_VISIBLE = 4

/** The two satellite columns, by the handle they hang from. */
export const GATE = "gate"
export const RUN = "run"

const COLUMN_X = {
  [GATE]: -(SAT_W + SAT_GAP_X),
  [RUN]: STAGE_W + SAT_GAP_X,
}

/**
 * Where the `index`-th satellite of a column sits, relative to its Stage node.
 */
export function satellitePosition(column, index) {
  return {
    x: COLUMN_X[column] ?? COLUMN_X[RUN],
    y: STAGE_H + SAT_DROP + index * (SAT_H + SAT_GAP_Y),
  }
}

/**
 * How many satellites a column of `total` items actually draws: every item up
 * to the cap, or the cap's worth plus one "+N more" node standing for the rest.
 * Returns `{ shown, overflow }`, where `overflow` is 0 when nothing is hidden.
 */
export function columnSlots(total) {
  if (total <= SAT_VISIBLE) return { shown: total, overflow: 0 }
  return { shown: SAT_VISIBLE, overflow: total - SAT_VISIBLE }
}

/**
 * How many rows a column occupies once overflow is folded into a node of its
 * own — the count auto-layout has to reserve vertical room for.
 */
export function columnRows(total) {
  const { shown, overflow } = columnSlots(total)
  return shown + (overflow > 0 ? 1 : 0)
}

/**
 * The bounding box of a whole Stage — its node plus whichever satellite columns
 * it actually has — and where the Stage node's top-left sits inside that box.
 *
 * Auto-layout lays out boxes and gets back their centres, so it needs both: the
 * size to reserve, and the offset to turn a box centre back into the Stage
 * position that gets persisted. A Stage with no satellites is exactly its own
 * node, so a flow that has not been configured yet lays out as tightly as it
 * did before any of this existed.
 */
export function stageBox({ conditionCount = 0, actionCount = 0 } = {}) {
  const gateRows = columnRows(conditionCount)
  const runRows = columnRows(actionCount)

  const left = gateRows > 0 ? COLUMN_X[GATE] : 0
  const right = runRows > 0 ? COLUMN_X[RUN] + SAT_W : STAGE_W

  const rows = Math.max(gateRows, runRows)
  const bottom =
    rows > 0 ? STAGE_H + SAT_DROP + rows * (SAT_H + SAT_GAP_Y) - SAT_GAP_Y : STAGE_H

  return {
    width: right - left,
    height: bottom,
    // The Stage node's own origin, measured from the box's top-left. `left` is
    // zero or negative, so the offset is its magnitude — written this way
    // rather than as `-left` because negating zero yields -0, which reaches
    // persisted positions and equality checks as a different value than 0.
    offsetX: Math.abs(left),
    offsetY: 0,
  }
}
