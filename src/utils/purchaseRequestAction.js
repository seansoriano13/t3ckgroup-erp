/**
 * The Open Purchase Request Stage Action's config (issue #304).
 *
 * The config is what the action's modal saves:
 *   buyer         { type: BUYER_EMPLOYEE, id } | { type: BUYER_COSTING_INCHARGE } | null
 *   extras        people selectors (resolvePeople.js) added as default members
 *   leaveOutRoles Deal Team roles not made members
 *   requesters    people selectors who may also request items, on top of
 *                 the Deal Team (who always may, #503)
 *   access        { until, stageId }, the purchasing members' window
 *
 * `sor_open_purchase_request` reads it from the Flow Snapshot and resolves
 * all of it itself; the client sends none of it.
 */

import { DEAL_TEAM_ROLES, SELECTOR_TYPES } from "./resolvePeople";

export const BUYER_EMPLOYEE = SELECTOR_TYPES.EMPLOYEE;
export const BUYER_COSTING_INCHARGE = "costing_incharge";

/** Deal Team roles an action may leave out of the request. */
export const LEAVE_OUT_ROLES = Object.keys(DEAL_TEAM_ROLES);

/** The setting's starting value: the whole Deal Team, who always may anyway. */
export const DEFAULT_REQUESTERS = Object.freeze(
  Object.keys(DEAL_TEAM_ROLES).map((role) => ({ type: SELECTOR_TYPES.ROLE, role })),
);

const isDealTeamRole = (s) => s?.type === SELECTOR_TYPES.ROLE && s.role in DEAL_TEAM_ROLES;

/** The requesters setting's selectors beyond the Deal Team, who always may request items. */
export function extraRequesters(requesters) {
  return Array.isArray(requesters) ? requesters.filter((s) => !isDealTeamRole(s)) : [];
}

export function purchaseRequestSummary(config = {}, nameOf = (id) => id) {
  if (config.buyer?.type === BUYER_EMPLOYEE) return `Buyer: ${nameOf(config.buyer.id)}`;
  if (config.buyer?.type === BUYER_COSTING_INCHARGE) {
    return "Buyer: the S0 Evaluation's Purchasing Incharge";
  }
  return "No default Buyer";
}
