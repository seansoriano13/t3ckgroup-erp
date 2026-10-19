/**
 * The Request Packing List Stage Action's config (issue #464, ADR 0033).
 *
 * The config is what the action's modal saves:
 *   notify   people and groups to tell when a draft Packing List is created. Empty or absent
 *            means the Warehouse staff list (the `transmittal_warehouse` list).
 *   access   { until, stageId }, edited in the action's detail panel like every other action's.
 *
 * `sor_request_packing_list` reads it from the Flow Snapshot and resolves all of it itself; the client
 * sends none of it.
 */

import { SELECTOR_TYPES } from "./resolvePeople";

function notifyLabel(selector, nameOf) {
  if (selector.type === SELECTOR_TYPES.EMPLOYEE) return nameOf(selector.id);
  if (selector.type === "team") return `everyone in ${selector.team}`;
  if (selector.type === "department") return `everyone in ${selector.department} department`;
  if (selector.type === SELECTOR_TYPES.ROLE) return String(selector.role || "").replace(/_/g, " ");
  if (selector.type === "group") return "an Employee Group";
  return "someone";
}

/** Who is told, in words, for the canvas card and detail panel. */
export function packingListNotifySummary(config = {}, nameOf = (id) => id) {
  const notify = Array.isArray(config.notify) ? config.notify : [];
  if (notify.length === 0) return "tells the Warehouse list";
  return `tells ${notify.map((s) => notifyLabel(s, nameOf)).join(", ")}`;
}

/** One line for the detail panel. */
export function packingListSummary(config = {}, nameOf = (id) => id) {
  return `Starts a draft Packing List unless the SOR already has an open one, and ${packingListNotifySummary(config, nameOf)}.`;
}
