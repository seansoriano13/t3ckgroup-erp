/**
 * Who can see one Stage — the single answer to a question the Flow Canvas
 * could not previously answer anywhere.
 *
 * Before this, "access" was four unrelated screens: the Flow's own Always
 * sees list, a Stage's shut-out roles and excluded groups, an access window
 * buried in each action's config, and another in each Assignment condition's.
 * Nothing joined them, so the canvas could only manage an opaque "Access"
 * chip that named nobody. This module is the join: give it a Stage's own rows
 * and the people they reference, get back the roster — by name, with who
 * called each person in and how far their window reaches.
 *
 * Pure, like canvasAccessLens (which answers the narrower "can THIS identity
 * see it?"): no query, no session, no database. That is what lets one shape
 * drive the canvas node, the Stage's Access tab, and their tests.
 */
import {
  DEAL_TEAM_ROLES,
  resolveGroupMemberIds,
  resolvePeople,
  selectorKey,
  normaliseTeam,
  SELECTOR_TYPES,
} from "./resolvePeople";
import { CONDITION_KINDS } from "../constants/stageGate";

/**
 * The four window rules.
 *
 * Each carries three strings because each sits in a different grammatical
 * slot, and writing one string for all three is what made the old copy
 * unreadable:
 *
 *   label  — the option itself. It names the SPAN, not the closing event.
 *            The old labels all began "Until…" and differed only in a word at
 *            the end ("is entered" vs "is left"), which is the word that
 *            decides whether the end Stage is included. "until X begins" and
 *            "through X" carry that same distinction in ordinary English.
 *   reach  — a noun phrase for the roster: "sees <reach>".
 *   helper — a full sentence under the picker, saying what the label cannot:
 *            which Stages in between come with it.
 *
 * Canonical here rather than in AccessWindowConfig, because the picker, the
 * roster and the canvas all have to say the same thing.
 */
export const ACCESS_WINDOW_RULES = Object.freeze({
  stage_left: {
    label: () => "Only this Stage",
    needsStage: false,
    reach: () => "this Stage only",
    helper: () => "They lose access the moment the deal moves on.",
  },
  stage_entered: {
    label: (name) =>
      name ? `This Stage, until ${name} begins` : "This Stage, until a later Stage begins",
    needsStage: true,
    reach: (name) => `this Stage, and every Stage before ${name}`,
    helper: (name) =>
      `Every Stage the deal passes through between here and ${name} — but not ${name} itself.`,
  },
  later_stage_left: {
    label: (name) => (name ? `This Stage, through ${name}` : "This Stage, through a later Stage"),
    needsStage: true,
    reach: (name) => `this Stage, through ${name}`,
    helper: (name) =>
      `Every Stage the deal passes through between here and ${name}, including ${name} itself.`,
  },
  terminal: {
    label: () => "The rest of the deal",
    needsStage: false,
    reach: () => "this Stage and every Stage after it",
    helper: () => "Closes only when the deal reaches a Terminal Stage.",
  },
});

export const DEFAULT_ACCESS = Object.freeze({ until: "stage_left" });

/** The rules that need a later Stage picked alongside them. */
export const NEEDS_LATER_STAGE = new Set(
  Object.entries(ACCESS_WINDOW_RULES)
    .filter(([, meta]) => meta.needsStage)
    .map(([rule]) => rule),
);

/**
 * One window in plain words: the rule as chosen, and the Stages it opens.
 * An end Stage that no longer resolves reads as the fallback the database
 * will actually apply, rather than naming a Stage that is gone.
 */
export function accessWindowSummary(access, stageNameById = {}) {
  const rule = ACCESS_WINDOW_RULES[access?.until] ? access.until : "stage_left";
  const meta = ACCESS_WINDOW_RULES[rule];
  const stageName = access?.stageId ? stageNameById[access.stageId] : null;

  // An end Stage that no longer resolves reads as the fallback the database
  // will actually apply, rather than naming a Stage that is gone.
  if (meta.needsStage && !stageName) {
    const fallback = ACCESS_WINDOW_RULES.stage_left;
    return {
      rule,
      ruleLabel: fallback.label(),
      reachLabel: fallback.reach(),
      helperLabel: fallback.helper(),
      fellBack: true,
    };
  }

  return {
    rule,
    ruleLabel: meta.label(stageName),
    reachLabel: meta.reach(stageName),
    helperLabel: meta.helper(stageName),
    fellBack: false,
  };
}

/** "Maria Daniella C. Duran" to "MD". Two letters, never more. */
export function initialsOf(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** How a selector reads in a roster — a name, a group, a Team, or a role. */
export function describeSelector(selector, { employees = [], groupsById = {} } = {}) {
  if (!selector) return "Someone";
  switch (selector.type) {
    case SELECTOR_TYPES.GROUP:
      return groupsById[selector.id]?.name || "Unknown group";
    case SELECTOR_TYPES.TEAM:
      return `Everyone in ${normaliseTeam(selector.team)}`;
    case SELECTOR_TYPES.DEPARTMENT:
      return `Everyone in ${normaliseTeam(selector.department)} department`;
    case SELECTOR_TYPES.ROLE:
      return DEAL_TEAM_ROLES[selector.role]?.label || selector.role;
    case SELECTOR_TYPES.EVERYONE:
      return "Everyone";
    default:
      return employees.find((e) => String(e.id) === String(selector.id))?.name || "Former employee";
  }
}

/**
 * Mirrors flowStageKinds.actionTitle. Duplicated deliberately: this module is
 * pure and must not reach into a component folder for a label. Call sites that
 * already import the canonical one pass it in as `actionLabel`.
 */
function defaultActionLabel(action) {
  const config = action?.config ?? {};
  const named = config.title || config.projectTitle;
  return (typeof named === "string" && named.trim()) || "Untitled action";
}

/**
 * Everyone a Stage's own rows call in, by employee, each carrying every call
 * that named them. Two actions naming the same person are two calls, not one
 * — matching `sor_stage_participants`, where each call-in opens its own row
 * and its own window.
 */
function callsByEmployee({
  conditions,
  actions,
  employees,
  groupMembersById,
  stageNameById,
  actionLabel,
}) {
  const byEmployee = new Map();

  const addCall = (employeeIds, call) => {
    for (const id of employeeIds) {
      const key = String(id);
      if (!byEmployee.has(key)) {
        byEmployee.set(key, {
          employeeId: key,
          name: employees.find((e) => String(e.id) === key)?.name || "Former employee",
          calls: [],
        });
      }
      byEmployee.get(key).calls.push(call);
    }
  };

  for (const condition of conditions) {
    if (condition?.kind !== CONDITION_KINDS.ASSIGNMENT) continue;
    addCall(resolvePeople(condition.config?.who || [], { employees, groupMembersById }), {
      kind: "condition",
      label: "Assignment condition",
      window: accessWindowSummary(condition.config?.access, stageNameById),
    });
  }

  for (const action of actions) {
    const memberIds = (action?.config?.members || [])
      .map((member) => member?.employeeId)
      .filter(Boolean);
    if (memberIds.length === 0) continue;
    addCall(memberIds, {
      kind: "action",
      label: actionLabel(action),
      window: accessWindowSummary(action.config?.access, stageNameById),
    });
  }

  return [...byEmployee.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The whole audience of one Stage.
 *
 * @returns {{
 *   dealTeam: Array<{ role: string, label: string, shutOut: boolean }>,
 *   alwaysSees: Array<{ key: string, label: string }>,
 *   everyoneSees: boolean,   // Always sees holds "Everyone"
 *   calledIn: Array<{ employeeId: string, name: string, calls: object[] }>,
 *   shutOutGroups: Array<{ id: string, name: string, memberCount: number }>,
 *   isRestricted: boolean,
 *   counts: object,
 * }}
 */
export function stageAudience({
  // Both of these come straight from flowAccessService, which returns null —
  // not undefined — for a Stage or Flow that has no access row yet, so a
  // parameter default would never fire. Every read below is optional.
  stageAccess,
  flowAccess,
  conditions = [],
  actions = [],
  employees = [],
  groupMembersById = {},
  groupsById = {},
  stageNameById = {},
  actionLabel = defaultActionLabel,
} = {}) {
  const shutOutRoles = stageAccess?.shutOutRoles || [];
  const excludedGroupIds = stageAccess?.excludedGroupIds || [];

  const dealTeam = Object.entries(DEAL_TEAM_ROLES).map(([role, meta]) => ({
    role,
    label: meta.label,
    shutOut: shutOutRoles.includes(role),
  }));

  const alwaysSees = (flowAccess?.alwaysSees || []).map((selector) => ({
    key: selectorKey(selector),
    label: describeSelector(selector, { employees, groupsById }),
  }));

  const shutOutGroups = excludedGroupIds.map((id) => ({
    id: String(id),
    name: groupsById[id]?.name || "Unknown group",
    memberCount: resolveGroupMemberIds(groupMembersById[id], employees).length,
  }));

  const calledIn = callsByEmployee({
    conditions,
    actions,
    employees,
    groupMembersById,
    stageNameById,
    actionLabel,
  });

  return {
    dealTeam,
    alwaysSees,
    everyoneSees: (flowAccess?.alwaysSees || []).some((s) => s?.type === SELECTOR_TYPES.EVERYONE),
    calledIn,
    shutOutGroups,
    isRestricted: shutOutRoles.length > 0 || excludedGroupIds.length > 0,
    counts: {
      seeingRoles: dealTeam.filter((role) => !role.shutOut).length,
      shutOutRoles: shutOutRoles.length,
      calledIn: calledIn.length,
      shutOutPeople: shutOutGroups.reduce((total, group) => total + group.memberCount, 0),
    },
  };
}
