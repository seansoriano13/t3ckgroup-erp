/**
 * The Open Costing Matrix Stage Action's config (issue #462, ADR 0033).
 *
 * The config is what the action's modal saves:
 *   salesIncharge       { type: "role", role } | { type: "employee", id }; blank = the Deal Owner role
 *   purchasingIncharge  { type: "employee", id } | null
 *   assigners           people selectors told when the matrix opens with no Purchasing Incharge
 *   markupPresetId      a markup preset (#269) whose factor becomes the matrix default
 *   extras              people selectors called in as Stage Participants (they see the matrix without money)
 *   access              { until, stageId }, their window (edited in the action's detail panel)
 *
 * `sor_open_costing_matrix` reads it from the Flow Snapshot and resolves all of it itself; the client
 * sends none of it.
 */

import { DEAL_TEAM_ROLES, SELECTOR_TYPES } from "./resolvePeople";

/** The default Sales Incharge: the SOR's Deal Owner. */
export const DEFAULT_SALES_INCHARGE = Object.freeze({ type: SELECTOR_TYPES.ROLE, role: "deal_owner" });

/** The Deal Team roles a Sales Incharge may be read off. */
export const SALES_INCHARGE_ROLES = Object.keys(DEAL_TEAM_ROLES);

/** The sales incharge as the config means it, with the Deal Owner role as the default. */
export function salesInchargeOf(config = {}) {
  return config.salesIncharge ?? DEFAULT_SALES_INCHARGE;
}

function salesInchargeLabel(selector, nameOf) {
  if (selector.type === SELECTOR_TYPES.EMPLOYEE) return nameOf(selector.id);
  return DEAL_TEAM_ROLES[selector.role]?.label ?? "the Deal Owner";
}

/**
 * One line for the action's canvas card and detail panel: who is named where. `presetLabel` is the markup
 * preset's name when the reader may see it; without one, a saved preset reads "a markup preset".
 */
export function costingMatrixSummary(config = {}, nameOf = (id) => id, { presetLabel = null } = {}) {
  const parts = [`Sales: ${salesInchargeLabel(salesInchargeOf(config), nameOf)}`];
  parts.push(
    config.purchasingIncharge?.type === SELECTOR_TYPES.EMPLOYEE
      ? `Purchasing: ${nameOf(config.purchasingIncharge.id)}`
      : "Purchasing: not named",
  );
  if (config.markupPresetId) parts.push(`Markup: ${presetLabel ?? "a markup preset"}`);
  return parts.join(" · ");
}
