/**
 * Issue #296 (part of #208, ADR 0021) — Flow Canvas "View as".
 *
 * A pure function so the eye-chip/dimming behavior on the canvas is provable
 * without a live snapshot, a signed-in session, or a database: give it a
 * snapshot-shaped draft and a selector to view as, get back one of
 * `hidden` | `calls-in` | `visible` per Stage.
 *
 * `selector` is the same shape resolvePeople.js already uses everywhere else
 * a "who" is named:
 *   { type: "role", role }       a Deal Team role key (resolvePeople's
 *                                 DEAL_TEAM_ROLES) — Restricted Stages shut
 *                                 out roles, not individual SORs, so this is
 *                                 the canvas-level, SOR-agnostic preview.
 *   { type: "group", id }        an Employee Group id
 *   { type: "employee", id }     one employee, resolved into groups via
 *                                 `groupMembersById`
 *
 * `snapshotLikeDraft` shape (both the live draft and a locked Flow Snapshot
 * satisfy this):
 *   {
 *     stages: [{
 *       id,
 *       shutOutRoles?: string[],        // flow_stage_access.shut_out_roles
 *       excludedGroupIds?: string[],    // flow_stage_access.excluded_group_ids
 *       calledIn?: Array<selector>,     // who this Stage calls in — a Stage
 *                                        // Participant call-in source, once
 *                                        // one exists; empty/absent today
 *     }],
 *     groupMembersById?: Record<string, { employeeIds?: string[], teams?: string[] }>,
 *     employees?: Array<{ id, sub_department?, is_deleted? }>,
 *   }
 */
import { resolveGroupMemberIds, normaliseTeam, SELECTOR_TYPES } from "./resolvePeople";

/** Whether `selector` (the viewer) is or resolves into `other` (a Stage's own selector). */
function selectorMatchesViewer(other, selector, { employees, groupMembersById }) {
  if (!other || !selector) return false;

  if (other.type === selector.type) {
    if (other.type === SELECTOR_TYPES.ROLE) return other.role === selector.role;
    if (other.type === SELECTOR_TYPES.TEAM) return normaliseTeam(other.team) === normaliseTeam(selector.team);
    return String(other.id) === String(selector.id);
  }

  // A group/team calls in an employee viewer if that employee resolves into it.
  if (selector.type === SELECTOR_TYPES.EMPLOYEE) {
    const employee = (employees || []).find((e) => String(e.id) === String(selector.id));
    if (!employee) return false;

    if (other.type === SELECTOR_TYPES.GROUP) {
      return resolveGroupMemberIds(groupMembersById?.[other.id], employees).some(
        (id) => String(id) === String(selector.id),
      );
    }
    if (other.type === SELECTOR_TYPES.TEAM) {
      return normaliseTeam(employee.sub_department) === normaliseTeam(other.team);
    }
  }

  return false;
}

/** Whether `selector` is shut out of `stage` — a role every one of it fails, or an excluded group it resolves into. */
function isShutOut(stage, selector, { employees, groupMembersById }) {
  const shutOutRoles = stage.shutOutRoles || [];
  const excludedGroupIds = stage.excludedGroupIds || [];

  if (selector.type === SELECTOR_TYPES.ROLE) {
    return shutOutRoles.includes(selector.role);
  }

  if (selector.type === SELECTOR_TYPES.GROUP) {
    return excludedGroupIds.some((id) => String(id) === String(selector.id));
  }

  if (selector.type === SELECTOR_TYPES.EMPLOYEE) {
    return excludedGroupIds.some((groupId) =>
      resolveGroupMemberIds(groupMembersById?.[groupId], employees).some(
        (id) => String(id) === String(selector.id),
      ),
    );
  }

  return false;
}

/** Whether `stage` explicitly calls `selector` in. */
function isCalledIn(stage, selector, context) {
  return (stage.calledIn || []).some((other) => selectorMatchesViewer(other, selector, context));
}

/**
 * One access-lens entry per Stage: `hidden` (this identity cannot see it at
 * all), `calls-in` (named to be called into it — always wins over hidden,
 * since being called in is what grants the access a shut-out role would
 * otherwise lack), or `visible` (nothing restricts or calls them).
 *
 * @param {{ snapshotLikeDraft: object, selector: object }} args
 * @returns {Record<string, "hidden" | "calls-in" | "visible">}
 */
export function canvasAccessLens({ snapshotLikeDraft, selector } = {}) {
  const stages = snapshotLikeDraft?.stages || [];
  const employees = snapshotLikeDraft?.employees || [];
  const groupMembersById = snapshotLikeDraft?.groupMembersById || {};
  const context = { employees, groupMembersById };

  const lens = {};
  for (const stage of stages) {
    if (!stage?.id) continue;

    if (!selector) {
      lens[stage.id] = "visible";
      continue;
    }

    if (isCalledIn(stage, selector, context)) {
      lens[stage.id] = "calls-in";
    } else if (isShutOut(stage, selector, context)) {
      lens[stage.id] = "hidden";
    } else {
      lens[stage.id] = "visible";
    }
  }
  return lens;
}

/** Whether a Stage's own config earns it the eye chip: restricted, or calls someone in. */
export function stageHasAccessNote(stage) {
  if (!stage) return false;
  return (
    (stage.shutOutRoles || []).length > 0 ||
    (stage.excludedGroupIds || []).length > 0 ||
    (stage.calledIn || []).length > 0
  );
}
