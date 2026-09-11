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

/** Vertical room a bracket's brace-and-label reserves above its Stages. */
export const BRACKET_H = 48
/** How far a bracket's brace extends past its outermost Stage on each side. */
export const BRACKET_PAD_X = 20

/**
 * The box a bracket's brace spans: wide enough to run from the left edge of
 * its leftmost Stage to the right edge of its rightmost, tall enough to sit
 * just above the topmost one — regardless of how the Stages between are
 * scattered, since nothing constrains two same-bracket Stages to sit
 * adjacent on the canvas.
 */
export function bracketBox(members) {
  const minX = Math.min(...members.map((s) => s.pos_x ?? 0)) - BRACKET_PAD_X
  const maxX = Math.max(...members.map((s) => (s.pos_x ?? 0) + STAGE_W)) + BRACKET_PAD_X
  const minY = Math.min(...members.map((s) => s.pos_y ?? 0))
  return { x: minX, y: minY - BRACKET_H, width: maxX - minX }
}

/** Canvas reading order: left to right by `pos_x`, top to bottom on a tie. */
export function byCanvasPosition(a, b) {
  if ((a.pos_x ?? 0) !== (b.pos_x ?? 0)) return (a.pos_x ?? 0) - (b.pos_x ?? 0)
  return (a.pos_y ?? 0) - (b.pos_y ?? 0)
}

/**
 * Consecutive runs of Stages sharing one `bracket_label`, in canvas order —
 * the single grouping rule every bracket brace is drawn from. The Flow Canvas
 * editor, the locked-snapshot viewer and the deal modal's stage control all
 * call this, so the three pictures can no longer disagree (issue #182).
 *
 * A label reused on Stages that another Stage sits between yields more than one
 * run, so a brace never spans a Stage it does not group. An unlabeled Stage is
 * its own one-Stage run with a `null` label: brace-drawing callers skip those,
 * the ribbon renders them with no heading.
 */
export function bracketRuns(stages = []) {
  const runs = []
  for (const stage of [...stages].sort(byCanvasPosition)) {
    const label = stage.bracket_label || null
    const last = runs[runs.length - 1]
    if (last && last.label === label) {
      last.stages.push(stage)
    } else {
      runs.push({ label, stages: [stage] })
    }
  }
  return runs
}

/**
 * The React Flow node for one labelled bracket run's brace — a pure annotation
 * spanning its Stages, drawn behind every real node (`zIndex: -1`) and inert
 * to the pointer. The Flow Canvas editor and the locked-snapshot viewer both
 * build braces from `bracketRuns`, so the node shape lives here too rather
 * than being hand-written at each call site. The id carries the run's first
 * Stage so a label split across two runs yields two distinct nodes.
 */
export function bracketNode(run) {
  const box = bracketBox(run.stages)
  return {
    id: `bracket:${run.label}:${run.stages[0].id}`,
    type: "bracket",
    position: { x: box.x, y: box.y },
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    deletable: false,
    zIndex: -1,
    data: { label: run.label, width: box.width },
    style: { width: box.width, pointerEvents: "none" },
  }
}

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
/** Horizontal gap between a Stage and one added from its outgoing plus. */
const NEW_STAGE_GAP_X = 96
/** Vertical step a nudged-down new Stage drops by, each time it still overlaps. */
const NEW_STAGE_GAP_Y = 24

function boxesOverlap(a, b) {
  return (
    a.x < b.x + STAGE_W &&
    a.x + STAGE_W > b.x &&
    a.y < b.y + STAGE_H &&
    a.y + STAGE_H > b.y
  )
}

/**
 * Drops `y` a step at a time until `(x, y)` clears every Stage's box — the one
 * placement rule `nextStagePosition` and `midpointStagePosition` both nudge
 * by, so a Stage landing on an occupied spot from either plus stacks
 * downward instead of piling onto whatever is already there.
 */
function nudgeUntilClear(x, y, stages) {
  while (
    stages.some((s) =>
      boxesOverlap({ x, y }, { x: s.pos_x ?? 0, y: s.pos_y ?? 0 }),
    )
  ) {
    y += STAGE_H + NEW_STAGE_GAP_Y
  }
  return y
}

/**
 * Where a Stage created from another Stage's outgoing plus (issue #195) lands:
 * straight to the source's right, nudged down until its box clears every
 * existing Stage's. Ignores satellite columns, the same simplification the
 * add-Stage dock's own staggering used, since a fresh Stage has none yet.
 */
export function nextStagePosition(source, stages = []) {
  const x = (source.pos_x ?? 0) + STAGE_W + NEW_STAGE_GAP_X
  const y = nudgeUntilClear(x, source.pos_y ?? 0, stages)
  return { x, y }
}

/**
 * Where a Stage inserted on a move (issue #196) lands: the midpoint between
 * the move's two ends, nudged down until its box clears every existing
 * Stage's — the same rule `nextStagePosition` nudges by, so inserting several
 * Stages on nearby moves stacks them rather than piling them on one point.
 */
export function midpointStagePosition(source, target, stages = []) {
  const x = Math.round(((source.pos_x ?? 0) + (target.pos_x ?? 0)) / 2)
  const y = nudgeUntilClear(x, Math.round(((source.pos_y ?? 0) + (target.pos_y ?? 0)) / 2), stages)
  return { x, y }
}

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
