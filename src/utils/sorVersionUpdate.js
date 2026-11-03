/**
 * Outdated SORs (#743): which SORs a bulk update touches, and who may update
 * which SOR. The database decides for real (`update_sor_versions`); this
 * mirrors it so the screen only offers what will be accepted.
 */

import { snapshotRows } from "../constants/salesFlow";
import { ACTION_KIND_META, actionTitle } from "../components/flow-canvas/flowStageKinds";

export const UPDATE_MODE = { ALL: "all", ONLY: "only", ALL_BUT: "allBut" };

/** The ids a bulk update acts on for a mode, given the ids the person ticked. */
export function idsForUpdateMode(mode, allIds, pickedIds = []) {
  const picked = new Set(pickedIds);
  if (mode === UPDATE_MODE.ONLY) return allIds.filter((id) => picked.has(id));
  if (mode === UPDATE_MODE.ALL_BUT) return allIds.filter((id) => !picked.has(id));
  return [...allIds];
}

const DEAL_TEAM_COLUMNS = [
  "registered_by",
  "deal_owner_id",
  "support_sales_1_id",
  "support_sales_2_id",
  "sales_director_id",
  "closing_sales_id",
];

/**
 * Whether `actor` may update `sor`'s version.
 *
 * Super Admin: any SOR. Head: their own department's SORs (`sorDepartment` is
 * the Deal Owner's, else the registrant's, department). Deal Team: their own
 * SOR, one at a time (`batchSize` 1), which is how the prompt calls it.
 */
export function canUpdateSorVersion({ actor, sor, sorDepartment = null, batchSize = 1 }) {
  if (!actor?.id || !sor) return false;
  if (actor.is_super_admin || actor.isSuperAdmin) return true;
  const isHead = actor.is_head || actor.isHead;
  if (isHead && sorDepartment && sorDepartment === actor.department) return true;
  return batchSize === 1 && DEAL_TEAM_COLUMNS.some((column) => sor[column] === actor.id);
}

/** An SOR is Outdated when it sits on a Flow Snapshot other than the latest. */
export function isOutdatedSor(sor, latestSnapshotId) {
  return Boolean(
    sor?.sale_type_id && sor.flow_snapshot_id && latestSnapshotId && sor.flow_snapshot_id !== latestSnapshotId,
  );
}

/** The prompt's "no" is remembered for this browser session only. */
const declined = new Set();
export const declineUpdatePrompt = (sorId) => declined.add(sorId);
export const hasDeclinedUpdatePrompt = (sorId) => declined.has(sorId);
export const resetDeclinedUpdatePrompts = () => declined.clear();

/** Versions a Super Admin may put an SOR back on: others that keep its Stage. */
export function revertTargets(snapshots, sor) {
  return (snapshots || []).filter(
    (s) => s.id !== sor.flow_snapshot_id && (s.snapshot_data?.stages || []).some((st) => st.id === sor.flow_stage_id),
  );
}

/** True when `target` is a later version than `source` (major, then minor). */
export function isForwardUpdate(source, target) {
  if (!source || !target) return false;
  const a = [source.version ?? 0, source.version_minor ?? 0];
  const b = [target.version ?? 0, target.version_minor ?? 0];
  return b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]);
}

/**
 * The Stage Actions an update adds for the Stage the SOR sits at (#846): those
 * in the target version's Stage that the SOR's current version lacks. Only an
 * update forward runs anything; going back, or Stages already passed, never do.
 */
export function addedActionsForStage({ source, target, stageId }) {
  if (!isForwardUpdate(source, target) || !stageId) return [];
  const rows = (snap) => snapshotRows(snap?.snapshot_data?.actions);
  const had = new Set(rows(source).filter((a) => a.stage_id === stageId).map((a) => a.id));
  return rows(target).filter((a) => a.stage_id === stageId && !had.has(a.id));
}

const NOTIFIES = {
  open_purchase_request: "notify Purchasing",
  open_costing_matrix: "notify Purchasing",
  evaluate_specification: "notify Purchasing",
  request_packing_list: "notify the Warehouse",
};

/**
 * What an added Action does, by its own name: "Group Task 'Site survey'; notify
 * Purchasing". A "When confirmed" Action only asks its Decider.
 */
export function describeAction(action) {
  const meta = ACTION_KIND_META[action?.kind];
  const label = meta?.label ?? "Action";
  const title = actionTitle(action);
  const parts = [meta?.titled === false || title === label ? label : `${label} '${title}'`];
  if (NOTIFIES[action?.kind]) parts.push(NOTIFIES[action.kind]);
  if (action?.config?.confirmMode === "confirm") parts.push("asks its Decider to create or skip");
  return parts.join("; ");
}

/** One summary line per Action: "12 deals will get: Group task". */
export function summariseAddedActions(entries) {
  const byAction = new Map();
  for (const { action, name } of entries) {
    const hit = byAction.get(action.id) || { name, count: 0 };
    hit.count += 1;
    byAction.set(action.id, hit);
  }
  return [...byAction.entries()].map(([id, { name, count }]) => ({
    id,
    count,
    text: `${count} ${count === 1 ? "deal" : "deals"} will get: ${name}`,
  }));
}

/** The warning for Stage Actions that failed to start after an update, or null. */
export function actionFailureMessage(actionFailures) {
  const names = [...new Set((actionFailures || []).map((f) => f.name))];
  if (names.length === 0) return null;
  return `Updated, but these automations failed. Create them by hand: ${names.join(", ")}.`;
}
