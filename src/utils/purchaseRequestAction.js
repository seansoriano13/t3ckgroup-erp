/**
 * The Open Purchase Request Stage Action's config (issue #304), and what of it
 * the database is sent.
 *
 * The config is what the action's modal saves:
 *   buyer         { type: "employee", id } | { type: BUYER_COSTING_INCHARGE } | null
 *   extras        people selectors (resolvePeople.js) added as default members
 *   leaveOutRoles Deal Team roles not made members
 *   access        { until, stageId }, the purchasing members' window
 *
 * Groups and the Buyer option are resolved here, to ids, because the employee
 * and group tables are read client-side as for a Decider. Who holds Purchasing
 * access and who is on the Deal Team are resolved by `sor_open_purchase_request`
 * itself.
 */

import { DEAL_TEAM_ROLES } from "./resolvePeople";

export const BUYER_COSTING_INCHARGE = "costing_incharge";

/** Deal Team roles an action may leave out of the request. */
export const LEAVE_OUT_ROLES = Object.keys(DEAL_TEAM_ROLES);

const RULES_NEEDING_A_STAGE = ["stage_entered", "later_stage_left"];

/**
 * @param config the action's stored config
 * @param extraMemberIds `config.extras` already resolved to employee ids
 * @param costingInchargeId the SOR's Costing Matrix Purchasing Incharge, when
 *   there is one; absent leaves the request unassigned for the queue's Take
 */
export function purchaseRequestPayload(config = {}, { extraMemberIds = [], costingInchargeId = null } = {}) {
  const until = config.access?.until || "stage_left";
  let buyerId = null;
  if (config.buyer?.type === "employee") buyerId = config.buyer.id ?? null;
  else if (config.buyer?.type === BUYER_COSTING_INCHARGE) buyerId = costingInchargeId ?? null;

  return {
    buyer_id: buyerId,
    extra_member_ids: extraMemberIds,
    left_out_roles: config.leaveOutRoles ?? [],
    access_until: until,
    access_until_stage_id: RULES_NEEDING_A_STAGE.includes(until) ? config.access?.stageId ?? null : null,
  };
}

export function purchaseRequestSummary(config = {}, nameOf = (id) => id) {
  if (config.buyer?.type === "employee") return `Buyer: ${nameOf(config.buyer.id)}`;
  if (config.buyer?.type === BUYER_COSTING_INCHARGE) {
    return "Buyer: the Costing Matrix's Purchasing Incharge";
  }
  return "No default Buyer";
}
