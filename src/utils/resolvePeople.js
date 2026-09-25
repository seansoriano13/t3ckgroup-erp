/**
 * Issue #201 — one answer to "who" for every Sales Flow setting.
 *
 * A "who" setting stores a list of selectors:
 *
 *   { type: "employee", id }
 *   { type: "group", id }        an Employee Group
 *   { type: "team", team }       everyone whose Sub-department matches
 *   { type: "role", role }       a Deal Team role, only meaningful per SOR
 *   { type: "everyone" }         every non-deleted employee, including later hires
 *
 * `resolvePeople` is the pure mirror of `sor_selector_covers` (20260930050000) and `employee_group_member_ids` in
 * Postgres (20260915010000_employee_groups.sql), used for previews such as
 * "3 people". The database is the authority for access; the policy tier holds
 * the two to the same answers.
 */

export const SELECTOR_TYPES = Object.freeze({
  EMPLOYEE: "employee",
  GROUP: "group",
  TEAM: "team",
  ROLE: "role",
  EVERYONE: "everyone",
});

/** Deal Team roles, each read off the SOR's own column. */
export const DEAL_TEAM_ROLES = Object.freeze({
  deal_owner: { label: "Deal Owner", columns: ["deal_owner_id"] },
  closing_sales: { label: "Closing Sales", columns: ["closing_sales_id"] },
  support_sales: { label: "Support Sales", columns: ["support_sales_1_id", "support_sales_2_id"] },
  sales_director: { label: "Sales Director", columns: ["sales_director_id"] },
  registrar: { label: "Registrar", columns: ["registered_by"] },
});

/** The comparison both sides use: trimmed and upper-cased, blank means none. */
export function normaliseTeam(value) {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * The Team options a picker offers: the distinct non-blank Sub-department
 * values of live employees, excluding "ALL". Branches ("CDO") appear as they
 * are until Teams are designed properly (Q55).
 */
export function teamOptions(employees = []) {
  const teams = new Set();
  for (const e of employees) {
    if (e?.is_deleted) continue;
    const team = normaliseTeam(e?.sub_department);
    if (team && team !== "ALL") teams.add(team);
  }
  return [...teams].sort();
}

/**
 * The employee ids one group means today: hand-picked members plus everyone
 * on a listed Team, deleted employees excluded. Archiving does not matter —
 * an archived group still resolves.
 *
 * @param {{ employeeIds?: string[], teams?: string[] } | undefined} group
 * @param {Array<{ id: string, sub_department?: string, is_deleted?: boolean }>} employees
 */
export function resolveGroupMemberIds(group, employees = []) {
  if (!group) return [];
  const picked = new Set((group.employeeIds || []).map(String));
  const teams = new Set((group.teams || []).map(normaliseTeam).filter(Boolean));
  return employees
    .filter((e) => !e.is_deleted)
    .filter((e) => picked.has(String(e.id)) || teams.has(normaliseTeam(e.sub_department)))
    .map((e) => e.id);
}

/**
 * Resolves selectors to live employee ids, deduplicated, in employee order.
 *
 * @param {Array<object>} selectors
 * @param {object} context
 * @param {Array<object>} context.employees every employee the caller knows about
 * @param {Record<string, { employeeIds?: string[], teams?: string[] }>} [context.groupMembersById]
 * @param {object} [context.opportunity] the SOR roles resolve against; without one a role resolves to nobody
 * @returns {string[]}
 */
export function resolvePeople(selectors, { employees = [], groupMembersById = {}, opportunity = null } = {}) {
  const wanted = new Set();

  for (const selector of selectors || []) {
    if (!selector) continue;
    switch (selector.type) {
      case SELECTOR_TYPES.EMPLOYEE:
        if (selector.id != null) wanted.add(String(selector.id));
        break;
      case SELECTOR_TYPES.EVERYONE:
        for (const e of employees) wanted.add(String(e.id));
        break;
      case SELECTOR_TYPES.GROUP:
        for (const id of resolveGroupMemberIds(groupMembersById[selector.id], employees)) {
          wanted.add(String(id));
        }
        break;
      case SELECTOR_TYPES.TEAM: {
        const team = normaliseTeam(selector.team);
        if (!team) break;
        for (const e of employees) {
          if (normaliseTeam(e.sub_department) === team) wanted.add(String(e.id));
        }
        break;
      }
      case SELECTOR_TYPES.ROLE: {
        if (!opportunity) break;
        for (const column of DEAL_TEAM_ROLES[selector.role]?.columns || []) {
          if (opportunity[column] != null) wanted.add(String(opportunity[column]));
        }
        break;
      }
      default:
        break;
    }
  }

  return employees.filter((e) => !e.is_deleted && wanted.has(String(e.id))).map((e) => e.id);
}

/** Stable identity for a selector, so a list can be deduplicated and keyed. */
export function selectorKey(selector) {
  if (!selector) return "";
  switch (selector.type) {
    case SELECTOR_TYPES.TEAM:
      return `team:${normaliseTeam(selector.team)}`;
    case SELECTOR_TYPES.ROLE:
      return `role:${selector.role}`;
    case SELECTOR_TYPES.EVERYONE:
      return "everyone";
    default:
      return `${selector.type}:${selector.id}`;
  }
}

/** True when any selector in the list points at this group. */
export function selectorsReferenceGroup(selectors, groupId) {
  return (selectors || []).some(
    (s) => s?.type === SELECTOR_TYPES.GROUP && String(s.id) === String(groupId),
  );
}
