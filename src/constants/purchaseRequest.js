/**
 * Purchase Request rules (issue #209, ticket #303).
 *
 * The single place the Requested Item status path lives. The schema's CHECK
 * constraint (20261005140000_purchase_requests.sql) holds the same nine
 * values; the status RPC (#306) enforces the same transitions server-side.
 *
 * Supersedes the per-row outcomes in ./procurement.js once the legacy
 * requests are migrated (#313) — `legacyOutcomeToStatus` is that mapping.
 */

import { PROCUREMENT_OUTCOME, normalizeOutcome } from "./procurement";

export const ITEM_STATUS = {
  REQUESTED: "requested",
  FROM_STOCK: "from_stock",
  TO_ORDER: "to_order",
  CANVASSING: "canvassing",
  ORDERED: "ordered",
  RECEIVED: "received",
  SUBSTITUTED: "substituted",
  CANNOT_SOURCE: "cannot_source",
  CANCELLED: "cancelled",
};

/** Every status, in path order: the main path first, then the ways out. */
export const ITEM_STATUSES = [
  ITEM_STATUS.REQUESTED,
  ITEM_STATUS.FROM_STOCK,
  ITEM_STATUS.TO_ORDER,
  ITEM_STATUS.CANVASSING,
  ITEM_STATUS.ORDERED,
  ITEM_STATUS.RECEIVED,
  ITEM_STATUS.SUBSTITUTED,
  ITEM_STATUS.CANNOT_SOURCE,
  ITEM_STATUS.CANCELLED,
];

export const ITEM_STATUS_LABELS = {
  [ITEM_STATUS.REQUESTED]: "Requested",
  [ITEM_STATUS.FROM_STOCK]: "From stock",
  [ITEM_STATUS.TO_ORDER]: "To order",
  [ITEM_STATUS.CANVASSING]: "Canvassing",
  [ITEM_STATUS.ORDERED]: "Ordered",
  [ITEM_STATUS.RECEIVED]: "Received",
  [ITEM_STATUS.SUBSTITUTED]: "Substituted",
  [ITEM_STATUS.CANNOT_SOURCE]: "Cannot source",
  [ITEM_STATUS.CANCELLED]: "Cancelled",
};

/** Statuses an item never leaves. Purchasing settled waits for every item to reach one. */
export const CLOSED_STATUSES = [
  ITEM_STATUS.FROM_STOCK,
  ITEM_STATUS.RECEIVED,
  ITEM_STATUS.SUBSTITUTED,
  ITEM_STATUS.CANNOT_SOURCE,
  ITEM_STATUS.CANCELLED,
];

export const isClosedStatus = (status) => CLOSED_STATUSES.includes(status);

/** Which side of the request a member sits on. Decides what they may change. */
export const MEMBER_SIDE = {
  PURCHASING: "purchasing",
  SALES: "sales",
  OTHER: "other",
};

/**
 * Forward steps on the main path. Canvassing is optional: To order may go
 * straight to Ordered, because single-source purchases are routine (#316).
 */
const NEXT_ON_PATH = {
  [ITEM_STATUS.REQUESTED]: [ITEM_STATUS.FROM_STOCK, ITEM_STATUS.TO_ORDER],
  [ITEM_STATUS.TO_ORDER]: [ITEM_STATUS.CANVASSING, ITEM_STATUS.ORDERED],
  [ITEM_STATUS.CANVASSING]: [ITEM_STATUS.ORDERED],
  [ITEM_STATUS.ORDERED]: [ITEM_STATUS.RECEIVED],
};

/** The ways out, open to purchasing from any open status. */
const WAYS_OUT = [ITEM_STATUS.SUBSTITUTED, ITEM_STATUS.CANNOT_SOURCE, ITEM_STATUS.CANCELLED];

/**
 * The statuses a member on `side` may move an item to from `status`.
 *
 * Purchasing walks the path and takes any way out; the sales side may only
 * cancel; anyone else changes nothing. A closed item goes nowhere.
 */
export function allowedTransitions(status, side) {
  if (!ITEM_STATUSES.includes(status) || isClosedStatus(status)) return [];
  if (side === MEMBER_SIDE.PURCHASING) return [...NEXT_ON_PATH[status], ...WAYS_OUT];
  if (side === MEMBER_SIDE.SALES) return [ITEM_STATUS.CANCELLED];
  return [];
}

/**
 * Purchasing settled: every Requested Item is closed. A request with no items
 * is settled, and so is an SOR with no request at all (pass null).
 */
export const isSettled = (items) => (items ?? []).every((item) => isClosedStatus(item?.status));

/**
 * The status a legacy `sor_procurement_requests` outcome becomes when it is
 * carried into a Purchase Request (#313). Throws on a value the legacy CHECK
 * never allowed, rather than quietly calling it Requested.
 */
const LEGACY_OUTCOME_STATUS = {
  [PROCUREMENT_OUTCOME.IN_PROGRESS]: ITEM_STATUS.CANVASSING,
  [PROCUREMENT_OUTCOME.PURCHASED]: ITEM_STATUS.ORDERED,
  [PROCUREMENT_OUTCOME.DELIVERED]: ITEM_STATUS.RECEIVED,
  [PROCUREMENT_OUTCOME.ALREADY_EXISTS]: ITEM_STATUS.FROM_STOCK,
  [PROCUREMENT_OUTCOME.SUBSTITUTED]: ITEM_STATUS.SUBSTITUTED,
  [PROCUREMENT_OUTCOME.UNAVAILABLE]: ITEM_STATUS.CANNOT_SOURCE,
};

export function legacyOutcomeToStatus(outcome) {
  if (outcome == null) return ITEM_STATUS.REQUESTED;
  const status = LEGACY_OUTCOME_STATUS[normalizeOutcome(outcome)];
  if (!status) throw new Error(`Unknown legacy procurement outcome: ${outcome}`);
  return status;
}
