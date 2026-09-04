/**
 * Sales Flow — pure evaluation of the graph (ADR 0006, issue #36).
 *
 * No database, no network: every value comes in as an argument and every
 * result goes out as a plain value. Prior art: constants/stageGate.js ↔
 * stageGate.test.js, constants/sor.js ↔ sor.test.js.
 *
 * This is the seam carrying most of the flow's decisions, so everything that
 * can be answered by calling a function with arguments is answered here rather
 * than inside a service or a component: whether a move is a legal edge, what a
 * Stage may move to next, where a deal enters, and whether a flow is fit to be
 * locked.
 *
 * The one thing this module does NOT do is compare positions. A flow is a
 * directed graph, so there is no canonical path between two arbitrary Stages
 * and no interval of "Stages crossed" — a move traverses exactly one edge.
 * `sort_order` is read in exactly one place (`entryStage`) and never to decide
 * whether something is permitted.
 */

/**
 * The Stages a deal on `fromStageId` may move to next, in flow order.
 *
 * What a Stage picker renders. An unknown Stage, or one nothing was drawn
 * from, offers nothing — a flow that has not been finished yet should offer no
 * moves rather than every move.
 */
export function outgoingStages(fromStageId, stages = [], edges = []) {
  if (!fromStageId) return []
  const targets = new Set(
    edges.filter((e) => e.from_stage_id === fromStageId).map((e) => e.to_stage_id),
  )
  return stages.filter((s) => targets.has(s.id)).sort(byFlowOrder)
}

/**
 * Whether this flow permits a move from one Stage to another.
 *
 * A single existence check over the edges, which is the whole benefit of
 * refusing self-edges and duplicates in the schema (0048): there is no
 * de-duplication or path-finding to get wrong. A move naming a Stage the flow
 * does not have is refused rather than ignored — the fail-safe direction,
 * matching how `sor.js` treats a code it does not recognise.
 */
export function isLegalMove(fromStageId, toStageId, edges = []) {
  if (!fromStageId || !toStageId || fromStageId === toStageId) return false
  return edges.some((e) => e.from_stage_id === fromStageId && e.to_stage_id === toStageId)
}

/** Canvas order: `sort_order`, then name so a tie is stable rather than arbitrary. */
function byFlowOrder(a, b) {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
  return String(a.name).localeCompare(String(b.name))
}

/**
 * Where a newly registered SOR lands, and where a Sale Type change lands one:
 * the Stage that sorts first.
 *
 * Derived rather than designated (unlike the Won Stage) because it needs no
 * ceremony — dragging a Stage to the top of the flow is already how the
 * Operations Manager says "deals start here". Deriving it instead from "the
 * Stage nothing points at" would answer nothing the moment a flow loops back
 * to its start, and loops are the reason this is a graph at all.
 */
export function entryStage(stages = []) {
  if (stages.length === 0) return null
  return [...stages].sort(byFlowOrder)[0]
}

/**
 * The color a Stage renders with, wherever a Stage needs exactly one color —
 * the canvas node, the Opportunity ribbon, a board column. A Stage's own
 * `color` (migration 20260828090000) wins when set; otherwise this falls back
 * to what the color has always meant here: role in the flow (Entry blue, Won
 * green, Terminal amber, everything else mauve — the same bucketing
 * FlowCanvasNode draws).
 */
export function flowStageTone(stage, flow, stagesOfFlow = []) {
  if (!stage) return "mauve"
  if (stage.color) return stage.color

  const entry = entryStage(stagesOfFlow)
  if (entry?.id === stage.id) return "blue"
  if (flow?.won_stage_id === stage.id) return "green"
  if (stage.is_terminal) return "amber"
  return "mauve"
}

/**
 * Every Stage reachable from the entry by following edges, entry included.
 *
 * Breadth-first over the edges she actually drew, so a Stage reachable only by
 * a skip counts and a Stage reachable only in a diagram does not. Cycles are
 * expected, hence the seen set.
 */
function reachableStageIds(stages, edges) {
  const entry = entryStage(stages)
  if (!entry) return new Set()

  const seen = new Set([entry.id])
  const queue = [entry.id]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const e of edges) {
      if (e.from_stage_id === current && !seen.has(e.to_stage_id)) {
        seen.add(e.to_stage_id)
        queue.push(e.to_stage_id)
      }
    }
  }
  return seen
}

/**
 * Why this flow cannot be locked yet, in the Operations Manager's words. An
 * empty array means it can.
 *
 * Every blocker at once rather than one at a time: this is read at the lock
 * screen with her in the room, and being told about the next problem only
 * after fixing the last one is the wrong shape of feedback for a meeting.
 *
 * A flow with no Stages reports only that — listing "no Won Stage" as well
 * would be telling her to designate one of the Stages she has not drawn.
 */
export function flowLockBlockers({ stages = [], edges = [], wonStageId = null } = {}) {
  if (stages.length === 0) return ["This flow has no Stages."]

  const blockers = []

  // Issue #36 — every flow must designate exactly one Won Stage, and the
  // canvas refuses to lock without one. Structurally there cannot be two (it
  // is a column on the flow, not a flag on the Stage), but it can be stale:
  // pointing at a Stage that was since deleted or moved to another flow.
  if (!wonStageId) {
    blockers.push("This flow has no Won Stage — set where the deal is won.")
  } else if (!stages.some((s) => s.id === wonStageId)) {
    blockers.push("This flow's Won Stage is not one of its own Stages.")
  }

  const entry = entryStage(stages)
  const reachable = reachableStageIds(stages, edges)
  for (const s of [...stages].sort(byFlowOrder)) {
    if (!reachable.has(s.id)) {
      blockers.push(`${s.name} cannot be reached from ${entry.name}.`)
    }
  }

  return blockers
}

/** Whether this flow is fit to be locked — see `flowLockBlockers` for why not. */
export function isFlowLockable(flow) {
  return flowLockBlockers(flow).length === 0
}

/**
 * Whether this deal is sitting on the Stage its flow's deals enter at.
 *
 * Note what this does NOT answer: whether the deal has ever moved. A flow may
 * loop back to its own entry, so a deal can be sitting here having already
 * been round once. Where that difference matters — changing an SOR's Sale
 * Type, which is permitted only before the first move (issue #36) — the
 * caller has to consult the deal's history as well, and that read belongs in
 * a service rather than in a pure module.
 */
export function isAtEntryStage(opportunity, stages = []) {
  const entry = entryStage(stages)
  if (!entry || !opportunity?.flow_stage_id) return false
  return opportunity.flow_stage_id === entry.id
}

/**
 * Whether a deal sitting on `flowStage` counts as lost.
 *
 * A flow Stage carries no `is_lost` flag — the global pipeline's kind of
 * terminal is `is_won` / `is_lost` as two separate flags, but a flow only
 * designates one special Stage (`won_stage_id`, on the flow, not the Stage —
 * see 0047/0048). So "lost" here is a terminal Stage that is not that one:
 * the deal has stopped moving somewhere other than where it was won.
 *
 * This is what `isRealizedOpportunity` (constants/sor.js) asks for a
 * flow-built deal instead of `isLostCode`, which only knows
 * `crm_pipeline_stages` codes a flow deal never carries.
 */
export function isLostFlowStage(flowStage, wonStageId) {
  if (!flowStage?.is_terminal) return false
  return flowStage.id !== wonStageId
}

/**
 * A Stage's Conditions/Actions as recorded in a Flow Snapshot (issue #83),
 * rather than as they stand live today. `snapshot_data.conditions`/`.actions`
 * are flat arrays (every Stage's, from the whole flow at lock time — see
 * `salesFlowService.lockFlow`), so resolving "this Stage's" is just a filter,
 * the same shape `stageConditionService`/`stageActionService`'s live queries
 * already narrow to when reading straight from the database.
 */
export function conditionsForSnapshotStage(snapshotConditions = [], stageId) {
  return (snapshotConditions || []).filter((c) => c.stage_id === stageId)
}

export function actionsForSnapshotStage(snapshotActions = [], stageId) {
  return (snapshotActions || []).filter((a) => a.stage_id === stageId)
}
