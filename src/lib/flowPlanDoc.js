import * as Y from 'yjs';

/**
 * The shared document a Flow Plan is (issue #116).
 *
 * The operational Flow Canvas edits rows: one writer at a time, last write
 * wins, and a second person's work is simply lost. A plan is the opposite
 * situation — two people sketching one flow together is the point of it — so a
 * plan is not rows but a CRDT document, and this module owns its shape and
 * every mutation on it.
 *
 * Why a keyed map per collection rather than a list: two people adding stages
 * at the same time both keep theirs, and two people editing *different* stages
 * never touch the same key, so nothing has to be resolved at all. Order is a
 * `sort_order` field rather than the position in a list, so reordering is an
 * ordinary field write that merges like every other one.
 *
 * Where a merge genuinely cannot decide — two people renaming one stage in the
 * same instant — Yjs picks a winner by client id, which is the same answer in
 * every session, rather than each session keeping its own and disagreeing until
 * someone reloads.
 *
 * Nothing here knows about the network. That is deliberate: it is what lets the
 * concurrency contract be tested by handing updates between two documents, with
 * no realtime connection involved.
 */

const STAGES = 'stages';
const EDGES = 'edges';
const CONDITIONS = 'conditions';
const ACTIONS = 'actions';
const FLOW = 'flow';

const DEFAULT_FLOW = {
  id: 'flow-1',
  sale_type_id: 'sandbox',
  won_stage_id: null,
  state: 'draft',
};

function newId() {
  return crypto.randomUUID();
}

/** A fresh, empty plan document. */
export function createFlowPlanDoc() {
  return new Y.Doc();
}

function collection(doc, name) {
  return doc.getMap(name);
}

function flowMap(doc) {
  return doc.getMap(FLOW);
}

/** Every entry of a collection as a plain object, sorted for a stable render. */
function readCollection(doc, name) {
  const rows = [];
  collection(doc, name).forEach((entry) => {
    rows.push(entry instanceof Y.Map ? entry.toJSON() : entry);
  });
  return rows.sort((a, b) => {
    const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    return order !== 0 ? order : String(a.id).localeCompare(String(b.id));
  });
}

/**
 * The plan as the canvas wants it: plain rows in the same shape
 * `salesFlowService` returns, so `FlowCanvas` cannot tell which it is looking
 * at.
 */
export function readFlowPlan(doc) {
  return {
    flow: { ...DEFAULT_FLOW, ...flowMap(doc).toJSON() },
    stages: readCollection(doc, STAGES),
    edges: readCollection(doc, EDGES),
    conditions: readCollection(doc, CONDITIONS),
    actions: readCollection(doc, ACTIONS),
  };
}

function putRow(doc, name, row) {
  const entry = new Y.Map();
  for (const [key, value] of Object.entries(row)) entry.set(key, value);
  collection(doc, name).set(row.id, entry);
  return row;
}

function patchRow(doc, name, id, patch) {
  const entry = collection(doc, name).get(id);
  if (!entry) return null;
  doc.transact(() => {
    for (const [key, value] of Object.entries(patch)) entry.set(key, value);
  });
  return entry.toJSON();
}

export function addStage(doc, { id = newId(), name, pos_x = 0, pos_y = 0, ...rest } = {}) {
  const stage = {
    id,
    flow_id: DEFAULT_FLOW.id,
    name,
    pos_x: Math.round(pos_x),
    pos_y: Math.round(pos_y),
    sort_order: collection(doc, STAGES).size,
    is_terminal: false,
    bracket_label: null,
    ...rest,
  };
  return putRow(doc, STAGES, stage);
}

export function updateStage(doc, stageId, patch) {
  return patchRow(doc, STAGES, stageId, patch);
}

/**
 * Removes a stage and everything that only existed because of it. Done in one
 * transaction so a peer never observes a plan where an edge points at a stage
 * that is already gone.
 */
export function deleteStage(doc, stageId) {
  doc.transact(() => {
    collection(doc, STAGES).delete(stageId);

    for (const [name, matches] of [
      [EDGES, (row) => row.from_stage_id === stageId || row.to_stage_id === stageId],
      [CONDITIONS, (row) => row.stage_id === stageId],
      [ACTIONS, (row) => row.stage_id === stageId],
    ]) {
      const map = collection(doc, name);
      for (const [id, entry] of [...map.entries()]) {
        if (matches(entry instanceof Y.Map ? entry.toJSON() : entry)) map.delete(id);
      }
    }

    if (flowMap(doc).get('won_stage_id') === stageId) flowMap(doc).set('won_stage_id', null);
  });
}

/**
 * Rewrites every stage's `sort_order` to match the given order. A stage another
 * session added meanwhile is not in the list and keeps the order it had, which
 * puts it after the reordered ones rather than dropping it.
 */
export function reorderStages(doc, orderedStageIds) {
  doc.transact(() => {
    orderedStageIds.forEach((stageId, index) => {
      const entry = collection(doc, STAGES).get(stageId);
      if (entry) entry.set('sort_order', index);
    });
  });
}

export function setWonStage(doc, stageId) {
  flowMap(doc).set('won_stage_id', stageId);
}

export function addEdge(doc, fromStageId, toStageId, { id = newId() } = {}) {
  return putRow(doc, EDGES, {
    id,
    flow_id: DEFAULT_FLOW.id,
    from_stage_id: fromStageId,
    to_stage_id: toStageId,
  });
}

export function removeEdge(doc, edgeId) {
  collection(doc, EDGES).delete(edgeId);
}

export function addStageCondition(doc, { id = newId(), ...payload }) {
  return putRow(doc, CONDITIONS, {
    id,
    sort_order: collection(doc, CONDITIONS).size,
    ...payload,
  });
}

export function removeStageCondition(doc, conditionId) {
  collection(doc, CONDITIONS).delete(conditionId);
}

export function addStageAction(doc, { id = newId(), ...payload }) {
  return putRow(doc, ACTIONS, {
    id,
    sort_order: collection(doc, ACTIONS).size,
    ...payload,
  });
}

export function updateStageAction(doc, actionId, patch) {
  return patchRow(doc, ACTIONS, actionId, patch);
}

export function removeStageAction(doc, actionId) {
  collection(doc, ACTIONS).delete(actionId);
}

/** Applies `[{ id, sortOrder }]`, the shape both reorder services already use. */
function applySortOrders(doc, name, updates) {
  doc.transact(() => {
    for (const { id, sortOrder } of updates) {
      const entry = collection(doc, name).get(id);
      if (entry) entry.set('sort_order', sortOrder);
    }
  });
}

export function reorderStageConditions(doc, updates) {
  applySortOrders(doc, CONDITIONS, updates);
}

export function reorderStageActions(doc, updates) {
  applySortOrders(doc, ACTIONS, updates);
}

/** The whole document, as the bytes `flow_plans.yjs_state` holds. */
export function encodeFlowPlanState(doc) {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Seeds a document from stored bytes.
 *
 * Merging rather than replacing is the point: applying an update to a document
 * that already has edits keeps both, which is what makes a reconnect a
 * reconciliation instead of a clobber.
 *
 * The first cut of the sandbox wrote `JSON.stringify(...)` into the same
 * column, so those rows are read as JSON and seeded into the document. They
 * convert on the next save and are never written again.
 */
export function loadFlowPlanState(doc, state) {
  if (!state || state.length === 0) return doc;

  const legacy = parseLegacyJsonState(state);
  if (legacy) {
    seedFromPlainPlan(doc, legacy);
    return doc;
  }

  Y.applyUpdate(doc, state instanceof Uint8Array ? state : new Uint8Array(state));
  return doc;
}

function parseLegacyJsonState(state) {
  if (state[0] !== 0x7b) return null; // not a '{', so not the old JSON blob
  try {
    const parsed = JSON.parse(new TextDecoder().decode(state));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function seedFromPlainPlan(doc, plan) {
  doc.transact(() => {
    if (plan.flow) {
      for (const [key, value] of Object.entries(plan.flow)) flowMap(doc).set(key, value);
    }
    for (const [name, rows] of [
      [STAGES, plan.stages],
      [EDGES, plan.edges],
      [CONDITIONS, plan.conditions],
      [ACTIONS, plan.actions],
    ]) {
      (rows || []).forEach((row, index) => {
        if (!row?.id) return;
        putRow(doc, name, { sort_order: index, ...row });
      });
    }
  });
}
