/**
 * Purchase Request rules (issue #209, ticket #303).
 *
 * The single place the Requested Item status path lives. The schema's CHECK
 * constraint (20261005130100_purchase_requests.sql) holds the same nine
 * values; the status RPC (#306) enforces the same transitions server-side.
 *
 * Supersedes the per-row outcomes in ./procurement.js once the legacy
 * requests are migrated (#313) — `legacyOutcomeToStatus` is that mapping.
 */

import { PROCUREMENT_OUTCOME, normalizeOutcome } from "./procurement";
import { STAGE_LABELS } from "./sor";
import { STATUS_THEME } from "./statusTheme";

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

/** The badge colour of each status (StatusBadge `theme`). */
export const ITEM_STATUS_THEME = {
  [ITEM_STATUS.REQUESTED]: STATUS_THEME.BLUE,
  [ITEM_STATUS.FROM_STOCK]: STATUS_THEME.GREEN,
  [ITEM_STATUS.TO_ORDER]: STATUS_THEME.AMBER,
  [ITEM_STATUS.CANVASSING]: STATUS_THEME.VIOLET,
  [ITEM_STATUS.ORDERED]: STATUS_THEME.BLUE,
  [ITEM_STATUS.RECEIVED]: STATUS_THEME.GREEN,
  [ITEM_STATUS.SUBSTITUTED]: STATUS_THEME.ORANGE,
  [ITEM_STATUS.CANNOT_SOURCE]: STATUS_THEME.RED,
  [ITEM_STATUS.CANCELLED]: STATUS_THEME.MAUVE,
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

/**
 * Why the request's SOR is closed for Purchasing (`pr_queue.sor_closed`), and
 * how that reads. Lost means a Terminal Stage before the Won Stage was reached.
 */
export const SOR_CLOSED_REASON = { DELETED: "deleted", LOST: "lost" };

export const SOR_CLOSED_LABELS = {
  [SOR_CLOSED_REASON.DELETED]: "SOR deleted",
  [SOR_CLOSED_REASON.LOST]: "SOR lost",
};

/** The label for a closed SOR, or null while it's open. */
export const sorClosedLabel = (reason) => SOR_CLOSED_LABELS[reason] ?? null;

/**
 * The SOR's Stage as a request row shows it (`pr_queue`): its Flow Stage, or,
 * for an SOR registered before Sales Flows, its legacy status. Null when neither.
 */
export const requestStageLabel = (row) => row?.stage_name || STAGE_LABELS[row?.sor_status] || null;

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
 *
 * `asOf` (a closed visit's `left_at`) reads the request as it stood then: an
 * item raised later doesn't count, and a closed item counts as closed only if
 * it closed by then. Closed is final, so its `status_changed_at` is when it
 * closed.
 */
export function isSettled(items, { asOf = null } = {}) {
  const cutoff = asOf ? new Date(asOf).getTime() : null;
  const at = (value) => (value ? new Date(value).getTime() : null);
  return (items ?? []).every((item) => {
    if (cutoff == null) return isClosedStatus(item?.status);
    if (at(item?.created_at) > cutoff) return true;
    if (!isClosedStatus(item?.status)) return false;
    const closedAt = at(item.status_changed_at ?? item.created_at);
    return closedAt == null || closedAt <= cutoff;
  });
}

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
