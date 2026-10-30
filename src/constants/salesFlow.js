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
 * Each Stage name's tone, for a row that carries only the Stage's name (the
 * Purchase Requests list). Names repeat across flows; when Stages sharing a
 * name disagree on tone, that name gets none (null) rather than a guess.
 * Takes `getAllStagesIndex`'s `{ flowsById, stagesByFlow }`.
 */
export function flowStageTonesByName({ flowsById = {}, stagesByFlow = {} } = {}) {
  const tones = new Map()
  for (const [flowId, stages] of Object.entries(stagesByFlow)) {
    for (const stage of stages) {
      const tone = flowStageTone(stage, flowsById[flowId], stages)
      tones.set(stage.name, tones.has(stage.name) && tones.get(stage.name) !== tone ? null : tone)
    }
  }
  return tones
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

  // #757 — Auto-move needs exactly one next Stage.
  for (const s of [...stages].sort(byFlowOrder)) {
    if (!s.auto_move) continue
    if (edges.filter((e) => e.from_stage_id === s.id).length !== 1) {
      blockers.push(`${s.name} is set to move on by itself, so it needs exactly one next Stage.`)
    }
  }

  return blockers
}

/**
 * What to say before publishing, that is not a reason to refuse (#463). The first warning the
 * canvas has; blockers (`flowLockBlockers`) stop a lock, warnings only tell.
 *
 * A costing condition (Costing priced or Costing settled) reads a matrix that exists only once an
 * Open Costing Matrix action ran. A Stage that some path from the entry reaches without passing a
 * Stage mounting that action can be sat on with no matrix: warned, once per such Stage. A Stage
 * that itself mounts the action is covered (the action runs on entry, before the condition is
 * read). `conditionsByStage` / `actionsByStage` are the canvas's live (unarchived) rows by Stage id.
 */
export function flowPublishWarnings({ stages = [], edges = [], conditionsByStage = {}, actionsByStage = {} } = {}) {
  const entry = entryStage(stages)
  if (!entry) return []

  const opensMatrix = (id) => (actionsByStage[id] ?? []).some((a) => a.kind === "open_costing_matrix" || a.kind === "evaluate_specification")
  const costingKinds = ["costing_priced", "costing_settled", "costing_evaluation_approved"]

  // Walk from the entry, never through (or onto) a Stage that opens the matrix.
  const seen = new Set()
  const queue = []
  if (!opensMatrix(entry.id)) {
    seen.add(entry.id)
    queue.push(entry.id)
  }
  while (queue.length > 0) {
    const current = queue.shift()
    for (const e of edges) {
      if (e.from_stage_id === current && !seen.has(e.to_stage_id) && !opensMatrix(e.to_stage_id)) {
        seen.add(e.to_stage_id)
        queue.push(e.to_stage_id)
      }
    }
  }

  const warnings = []
  for (const s of [...stages].sort(byFlowOrder)) {
    if (!seen.has(s.id)) continue
    const kinds = (conditionsByStage[s.id] ?? []).map((c) => c.kind).filter((k) => costingKinds.includes(k))
    if (kinds.length === 0) continue
    warnings.push(
      `${s.name} checks the S0 Evaluation, but a path to it skips every Open S0 Evaluation action, so a deal can reach it with no matrix.`,
    )
  }
  return warnings
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
 * How deals end on a Terminal Stage (`flow_stages.terminal_outcome`). The Won
 * Stage usually sits mid-flow, so a flow ends on Terminal Stages like Closed
 * Won and Closed Lost; each says which it is. Unset means lost.
 */
export const TERMINAL_OUTCOME = { WON: "won", LOST: "lost" }

/** Whether a Terminal Stage is explicitly set to end deals as lost. An unset outcome is not Lost. */
export function endsAsLost(flowStage) {
  return Boolean(flowStage?.is_terminal) && flowStage.terminal_outcome === TERMINAL_OUTCOME.LOST
}

/** Whether a Terminal Stage ends deals as won (e.g. Closed Won). */
export function endsAsWon(flowStage) {
  return Boolean(flowStage?.is_terminal) && flowStage.terminal_outcome === TERMINAL_OUTCOME.WON
}

/** Whether a Terminal Stage ends deals as lost: outcome explicitly Lost. */
export function endsAsLost(flowStage) {
  return Boolean(flowStage?.is_terminal) && flowStage.terminal_outcome === TERMINAL_OUTCOME.LOST
}

/**
 * Whether a deal sitting on `flowStage` counts as lost: a Terminal Stage whose
 * outcome is explicitly Lost and that is not the flow's Won Stage
 * (`won_stage_id`, on the flow). A Terminal Stage with no outcome set (like
 * "BG CHECKING") is not lost.
 *
 * The flow twin of `isLostCode`, which only knows `crm_pipeline_stages` codes
 * a flow deal never carries.
 */
export function isLostFlowStage(flowStage, wonStageId) {
  if (!flowStage?.is_terminal) return false
  return flowStage.id !== wonStageId && endsAsLost(flowStage)
}

/**
 * Classifies a Stage within a Sales Flow graph:
 * - "WON": the designated Won Stage
 * - "POST_WON": an active Stage strictly downstream of the Won Stage, or a
 *   Terminal Stage that ends as won (Closed Won)
 * - "PRE_WON": an active Stage preceding the Won Stage (open pipeline)
 * - "LOST": a Terminal Stage that is not the Won Stage and ends as lost
 * - null: unknown or unresolvable Stage, or a Terminal Stage with no outcome
 */
export function classifyFlowStage(stageId, { stages = [], edges = [], wonStageId = null } = {}) {
  if (!stageId) return null
  const stage = stages.find((s) => s.id === stageId)
  if (!stage) return null

  if (stage.is_terminal && stage.id !== wonStageId) {
    if (endsAsWon(stage)) return "POST_WON"
    return endsAsLost(stage) ? "LOST" : null
  }

  if (wonStageId && stage.id === wonStageId) {
    return "WON"
  }

  if (!wonStageId) {
    return "PRE_WON"
  }

  const canReach = (start, target) => {
    if (!start || !target) return false
    if (start === target) return true
    const seen = new Set([start])
    const queue = [start]
    while (queue.length > 0) {
      const curr = queue.shift()
      for (const e of edges) {
        if (e.from_stage_id === curr && !seen.has(e.to_stage_id)) {
          if (e.to_stage_id === target) return true
          seen.add(e.to_stage_id)
          queue.push(e.to_stage_id)
        }
      }
    }
    return false
  }

  const reachableFromWon = canReach(wonStageId, stage.id)
  const canReachWon = canReach(stage.id, wonStageId)

  if (reachableFromWon && !canReachWon) {
    return "POST_WON"
  }

  if (canReachWon && !reachableFromWon) {
    return "PRE_WON"
  }

  // Fallback when edges are empty or provide no path between stage and wonStageId:
  // use relative stage position (sort_order if available, otherwise array index order).
  if (!canReachWon && !reachableFromWon) {
    const wonIndex = stages.findIndex((s) => s.id === wonStageId)
    const stageIndex = stages.findIndex((s) => s.id === stageId)
    if (wonIndex !== -1 && stageIndex !== -1) {
      const wonSort = stages[wonIndex].sort_order ?? wonIndex
      const stageSort = stages[stageIndex].sort_order ?? stageIndex
      if (stageSort > wonSort) {
        return "POST_WON"
      }
      return "PRE_WON"
    }
  }

  return "PRE_WON"
}

/**
 * Whether a deal sitting on `flowStage` counts as Open Pipeline:
 * an active stage preceding the Won Stage in the flow graph.
 */
export function isPreWonFlowStage(flowStage, snapshotData = {}) {
  if (!flowStage) return false
  const classification = classifyFlowStage(flowStage.id, {
    stages: snapshotData.stages || [],
    edges: snapshotData.edges || [],
    wonStageId: snapshotData.wonStageId ?? null,
  })
  return classification === "PRE_WON"
}

/**
 * Whether a deal sitting on `flowStage` counts as Won / Realized:
 * sitting on the designated Won Stage or an active post-won stage downstream of it.
 */
export function isWonOrPostWonFlowStage(flowStage, snapshotData = {}) {
  if (!flowStage) return false
  const classification = classifyFlowStage(flowStage.id, {
    stages: snapshotData.stages || [],
    edges: snapshotData.edges || [],
    wonStageId: snapshotData.wonStageId ?? null,
  })
  return classification === "WON" || classification === "POST_WON"
}

/**
 * The rows out of a Flow Snapshot's `conditions` or `actions`, as a flat list
 * whichever shape they were stored in.
 *
 * Newer snapshots store a flat array (every Stage's, from the whole flow at
 * lock time — see `salesFlowService.lockFlow`). Older ones store an object
 * keyed by `stage_id` with a list of rows under each. `materializeSnapshotIntoFlow`
 * already accepts both when importing; this is the same coercion for the read
 * paths, so a version page never has to know which era it is looking at.
 */
export function snapshotRows(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object") return Object.values(value).flat()
  return []
}

/**
 * A Stage's Conditions/Actions as recorded in a Flow Snapshot (issue #83),
 * rather than as they stand live today — resolving "this Stage's" is just a
 * filter, the same shape `stageConditionService`/`stageActionService`'s live
 * queries already narrow to when reading straight from the database. Both
 * snapshot shapes are accepted (see `snapshotRows`).
 */
export function conditionsForSnapshotStage(snapshotConditions, stageId) {
  return snapshotRows(snapshotConditions).filter((c) => c.stage_id === stageId)
}

export function actionsForSnapshotStage(snapshotActions, stageId) {
  return snapshotRows(snapshotActions).filter((a) => a.stage_id === stageId)
}

/**
 * The title a Stage Action automation gives the task it creates: the deal's
 * Sales Reference then its project name, each bracketed (issue #178). Shared
 * by both automation kinds — the one creating an individual task and the one
 * creating a Group Task — so a deal is identifiable from a task list without
 * opening anything, and the two automations can never drift into different
 * formats.
 *
 * A deal with no Sales Reference yet (it has none until it leaves Lead)
 * prints a stated placeholder rather than collapsing to a blank, so the
 * `[ref] [project]` shape stays parseable either way.
 */
export function stageActionTaskTitle({ salesReference, projectTitle } = {}) {
  const ref = salesReference || "No Sales Reference"
  const project = projectTitle || "Untitled Project"
  return `[${ref}] [${project}]`
}

/**
 * The `snapshot_data` shape a publish would write, from the live pieces of a
 * draft (issue #189). Pure — everything the caller already fetched comes in
 * as an argument — so the shaping rule this Flow Snapshot commits to can be
 * unit tested without a database, and so `salesFlowService.buildSnapshotData`
 * (the async wrapper that actually fetches `actions`/`conditions`) and
 * `diffFlowSnapshots` (which reads this same shape from an already-published
 * Snapshot) can never disagree about what a "changed" flow looks like.
 */
export function buildDraftSnapshotData({
  flow,
  stages = [],
  edges = [],
  actions = [],
  conditions = [],
  stageFields = [],
  formFields = [],
  followUps = [],
  // Access configuration (issue #292): who always sees this Sale Type's
  // SORs, who may open the Journey, and per-Stage shut-out roles/excluded
  // groups. `flow` is the single Always-sees/Journey-viewers row (or null,
  // when never saved) and `stages` is one entry per Stage carrying its own
  // saved row — same "frozen with everything else" reasoning as `formFields`.
  access = { flow: null, stages: [] },
} = {}) {
  return {
    stages,
    edges,
    actions,
    conditions,
    stageFields,
    // The flow's registration-form customization. Frozen with everything else
    // so an SOR registered against a version was registered against that
    // version's form, and so reverting a version reverts its form too.
    formFields,
    followUps,
    access,
    wonStageId: flow?.won_stage_id ?? null,
    awardStageId: flow?.award_stage_id ?? null,
    saleTypeId: flow?.sale_type_id ?? null,
  }
}

/**
 * Normalizes an item for semantic comparison between Flow Snapshots:
 * - Omits database timestamps (`created_at`, `updated_at`), canvas coordinates
 *   (`pos_x`, `pos_y`), and container foreign keys (`flow_id`) that do not
 *   represent changes to the SORS business process.
 * - Omits null/undefined/empty-string optional properties so missing keys match
 *   explicit nulls.
 * - Recursively sorts object keys so key order differences (e.g. from Postgres
 *   JSONB normalization) never cause false diffs.
 */
function canonicalItemForDiff(item) {
  if (item === null || typeof item !== "object") return item;
  if (Array.isArray(item)) return item.map(canonicalItemForDiff);

  const ignoredKeys = new Set(["created_at", "updated_at", "pos_x", "pos_y", "flow_id"]);
  const sorted = {};
  for (const key of Object.keys(item).sort()) {
    if (ignoredKeys.has(key)) continue;
    const val = item[key];
    if (val === null || val === undefined || val === "") continue;
    sorted[key] = canonicalItemForDiff(val);
  }
  return sorted;
}

function areItemsEqual(itemA, itemB) {
  return JSON.stringify(canonicalItemForDiff(itemA)) === JSON.stringify(canonicalItemForDiff(itemB));
}

/**
 * Added, removed and changed entries between two lists of the same kind of
 * row, matched by `id`. "Changed" means the same id survived with a
 * different value somewhere on it — a deep semantic comparison.
 */
function diffById(itemsA = [], itemsB = []) {
  const byIdA = new Map(itemsA.map((item) => [item.id, item]));
  const byIdB = new Map(itemsB.map((item) => [item.id, item]));

  const added = itemsB.filter((item) => !byIdA.has(item.id));
  const removed = itemsA.filter((item) => !byIdB.has(item.id));
  const changed = [];
  for (const [id, before] of byIdA) {
    const after = byIdB.get(id);
    if (after && !areItemsEqual(before, after)) {
      changed.push({ id, before, after });
    }
  }

  return { added, removed, changed };
}

/**
 * What changed between two Flow Snapshots (issue #36's user story #65,
 * issue #83's `snapshot_data` shape) — a Super Admin's answer to "what
 * changed since Tuesday" without reading both in full.
 *
 * Edges carry no "changed" state: an edge is only ever present or absent,
 * identified by the same `id` a Flow Snapshot already stores it under.
 */
export function diffFlowSnapshots(snapshotDataA = {}, snapshotDataB = {}) {
  const stages = diffById(snapshotDataA.stages, snapshotDataB.stages)
  const edgesDiff = diffById(snapshotDataA.edges, snapshotDataB.edges)
  const edges = { added: edgesDiff.added, removed: edgesDiff.removed }
  const actions = diffById(snapshotDataA.actions, snapshotDataB.actions)
  const conditions = diffById(snapshotDataA.conditions, snapshotDataB.conditions)
  const stageFields = diffById(snapshotDataA.stageFields, snapshotDataB.stageFields)
  const formFields = diffById(snapshotDataA.formFields, snapshotDataB.formFields)
  const followUps = diffById(snapshotDataA.followUps, snapshotDataB.followUps)
  // The flow-level Always-sees/Journey-viewers row has no natural id list —
  // it is a single row or none — so it is diffed the same way as everything
  // else in this module, wrapped as a one-item list under a fixed id.
  const accessFlowA = snapshotDataA.access?.flow ? [{ id: "flow", ...snapshotDataA.access.flow }] : []
  const accessFlowB = snapshotDataB.access?.flow ? [{ id: "flow", ...snapshotDataB.access.flow }] : []
  const accessFlow = diffById(accessFlowA, accessFlowB)
  const accessStages = diffById(snapshotDataA.access?.stages, snapshotDataB.access?.stages)
  const wonStageChanged = (snapshotDataA.wonStageId ?? null) !== (snapshotDataB.wonStageId ?? null)

  const hasChanges =
    wonStageChanged ||
    [stages, edges, actions, conditions, stageFields, formFields, followUps, accessFlow, accessStages].some(
      (d) => d.added.length > 0 || d.removed.length > 0 || (d.changed?.length || 0) > 0,
    )

  return {
    stages,
    edges,
    actions,
    conditions,
    stageFields,
    formFields,
    followUps,
    accessFlow,
    accessStages,
    wonStageChanged,
    hasChanges,
  }
}

/**
 * A single number for "how many changes" from a `diffFlowSnapshots` result
 * (issue #192) — the status chip's "N changes" and the version rail's
 * expanded rows both need one count, not four groups of `added`/`removed`/
 * `changed` arrays to re-sum themselves.
 */
export function countFlowSnapshotChanges(diffResult) {
  if (!diffResult) return 0
  const byGroup = (group) =>
    (group?.added?.length || 0) + (group?.removed?.length || 0) + (group?.changed?.length || 0)

  return (
    byGroup(diffResult.stages) +
    byGroup(diffResult.edges) +
    byGroup(diffResult.actions) +
    byGroup(diffResult.conditions) +
    byGroup(diffResult.stageFields) +
    byGroup(diffResult.formFields) +
    byGroup(diffResult.followUps) +
    byGroup(diffResult.accessFlow) +
    byGroup(diffResult.accessStages) +
    (diffResult.wonStageChanged ? 1 : 0)
  )
}
