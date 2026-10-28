/**
 * Outdated SORs (#743): which SORs a bulk update touches, and who may update
 * which SOR. The database decides for real (`update_sor_versions`); this
 * mirrors it so the screen only offers what will be accepted.
 */

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
