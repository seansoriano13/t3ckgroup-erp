/**
 * Issue #296 (part of #208, ADR 0021) — Flow Canvas "View as".
 *
 * A pure function so the eye-chip/dimming behavior on the canvas is provable
 * without a live snapshot, a signed-in session, or a database: give it a
 * snapshot-shaped draft and a selector to view as, get back one verdict per
 * Stage:
 *   hidden     no access at all — shut out, or named nowhere on the flow
 *   calls-in   called in as a Stage Participant
 *   deal-team  a Deal Team role (full access)
 *   can-edit   Always edits (or Everyone)
 *   view-only  Always sees, not Always edits
 *   visible    no selector: the lens is off
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
 *       calledIn?: Array<selector>,     // who this Stage calls in — see
 *                                        // stageCalledInSelectors() below for
 *                                        // how the draft's own conditions/
 *                                        // actions are turned into this list
 *     }],
 *     groupMembersById?: Record<string, { employeeIds?: string[], teams?: string[] }>,
 *     employees?: Array<{ id, department?, sub_department?, is_deleted? }>,
 *     alwaysSees?: Array<selector>,     // flow_access_settings.always_sees
 *     alwaysEdits?: Array<selector>,    // flow_access_settings.always_edits
 *   }
 */
import { resolveGroupMemberIds, normaliseTeam, SELECTOR_TYPES } from "./resolvePeople";
import { CONDITION_KINDS } from "../constants/stageGate";

/** Whether `selector` (the viewer) is or resolves into `other` (a Stage's own selector). */
function selectorMatchesViewer(other, selector, { employees, groupMembersById }) {
  if (!other || !selector) return false;

  if (other.type === SELECTOR_TYPES.EVERYONE) return true;

  if (other.type === selector.type) {
    if (other.type === SELECTOR_TYPES.ROLE) return other.role === selector.role;
    if (other.type === SELECTOR_TYPES.TEAM) return normaliseTeam(other.team) === normaliseTeam(selector.team);
    if (other.type === SELECTOR_TYPES.DEPARTMENT) {
      return normaliseTeam(other.department) === normaliseTeam(selector.department);
    }
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
    if (other.type === SELECTOR_TYPES.DEPARTMENT) {
      return normaliseTeam(employee.department) === normaliseTeam(other.department);
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
 * One access-lens entry per Stage, for the identity being viewed:
 *
 *   `calls-in`  named to be called into it — always wins over shut out, since
 *               a Stage Participant sits outside the Deal Team a Restricted
 *               Stage closes.
 *   `hidden`    no access at all: shut out here, or not a Deal Team role, not
 *               in Always sees / Always edits, and not called in. A person
 *               may still hold a Deal Team role on an individual SOR — the
 *               canvas has no SOR to check.
 *   `deal-team` a Deal Team role: full access.
 *   `can-edit`  in Always edits (which implies view), or Everyone.
 *   `view-only` in Always sees but not Always edits.
 *   `visible`   no selector — the lens is off.
 *
 * A Restricted Stage shuts out Always sees and Always edits too.
 *
 * @param {{ snapshotLikeDraft: object, selector: object }} args
 * @returns {Record<string, "hidden" | "calls-in" | "deal-team" | "can-edit" | "view-only" | "visible">}
 */
export function canvasAccessLens({ snapshotLikeDraft, selector } = {}) {
  const stages = snapshotLikeDraft?.stages || [];
  const employees = snapshotLikeDraft?.employees || [];
  const groupMembersById = snapshotLikeDraft?.groupMembersById || {};
  const alwaysSees = snapshotLikeDraft?.alwaysSees || [];
  const alwaysEdits = snapshotLikeDraft?.alwaysEdits || [];
  const context = { employees, groupMembersById };
  const inList = (list) => list.some((other) => selectorMatchesViewer(other, selector, context));

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
    } else if (selector.type === SELECTOR_TYPES.ROLE) {
      lens[stage.id] = "deal-team";
    } else if (inList(alwaysEdits)) {
      lens[stage.id] = "can-edit";
    } else if (inList(alwaysSees)) {
      lens[stage.id] = "view-only";
    } else {
      lens[stage.id] = "hidden";
    }
  }
  return lens;
}

/**
 * Who a Stage calls in, built from its own conditions and actions (issue
 * #294's Stage Participant call-ins) rather than any config of its own:
 *
 *   - An Assignment condition's `config.who` — a resolvePeople.js selector
 *     list (employee/group/team) — every one of them.
 *   - Every action's `config.members[].employeeId` — a group task's or
 *     individual task's assignees are always specific employees, never a
 *     role/group/team, so each becomes an `{ type: "employee", id }`.
 *
 * `conditions`/`actions` are the raw `stage_conditions`/`flow_stage_actions`
 * rows (`kind`, `config`) as `stageConditionService`/`stageActionService`
 * already return them — no reshaping needed to call this from the canvas.
 */
export function stageCalledInSelectors(conditions = [], actions = []) {
  const selectors = [];

  for (const condition of conditions) {
    if (condition?.kind !== CONDITION_KINDS.ASSIGNMENT) continue;
    for (const who of condition.config?.who || []) {
      if (who) selectors.push(who);
    }
  }

  for (const action of actions) {
    for (const member of action?.config?.members || []) {
      if (member?.employeeId) selectors.push({ type: SELECTOR_TYPES.EMPLOYEE, id: member.employeeId });
    }
  }

  return selectors;
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
