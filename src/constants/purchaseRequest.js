/**
 * Purchase Request rules (issue #209, ticket #303).
 *
 * The single place the Requested Item status path lives. The schema's CHECK
 * constraint (20261005130100_purchase_requests.sql) holds the same eight
 * values; the status RPC (#306) enforces the same transitions server-side.
 *
 * Supersedes the per-row outcomes in ./procurement.js once the legacy
 * requests are migrated (#313) — `legacyOutcomeToStatus` is that mapping.
 */

import { PROCUREMENT_OUTCOME, normalizeOutcome } from "./procurement";
import { STAGE_LABELS } from "./sor";
import { STATUS_THEME } from "./statusTheme";

export const ITEM_STATUS = {
  NOT_CHECKED: "not_checked",
  AVAILABLE: "available",
  TO_PURCHASE: "to_purchase",
  STILL_CANVASSING: "still_canvassing",
  PURCHASED: "purchased",
  RECEIVED: "received",
  CANNOT_SOURCE: "cannot_source",
  CANCELLED: "cancelled",
};

/** An existing Canvass can still be attached to an item at these statuses (past them the buying is done). */
export const CANVASS_ATTACHABLE_STATUSES = [ITEM_STATUS.NOT_CHECKED, ITEM_STATUS.TO_PURCHASE, ITEM_STATUS.STILL_CANVASSING];

/** Every status, in path order: the main path first, then the ways out. */
export const ITEM_STATUSES = [
  ITEM_STATUS.NOT_CHECKED,
  ITEM_STATUS.AVAILABLE,
  ITEM_STATUS.TO_PURCHASE,
  ITEM_STATUS.STILL_CANVASSING,
  ITEM_STATUS.PURCHASED,
  ITEM_STATUS.RECEIVED,
  ITEM_STATUS.CANNOT_SOURCE,
  ITEM_STATUS.CANCELLED,
];

export const ITEM_STATUS_LABELS = {
  [ITEM_STATUS.NOT_CHECKED]: "Not checked",
  [ITEM_STATUS.AVAILABLE]: "Available",
  [ITEM_STATUS.TO_PURCHASE]: "To purchase",
  [ITEM_STATUS.STILL_CANVASSING]: "Still canvassing",
  [ITEM_STATUS.PURCHASED]: "Purchased",
  [ITEM_STATUS.RECEIVED]: "Received",
  [ITEM_STATUS.CANNOT_SOURCE]: "Cannot source",
  [ITEM_STATUS.CANCELLED]: "Cancelled",
};

/** The badge colour of each status (StatusBadge `theme`). */
export const ITEM_STATUS_THEME = {
  [ITEM_STATUS.NOT_CHECKED]: STATUS_THEME.GREY,
  [ITEM_STATUS.AVAILABLE]: STATUS_THEME.TEAL,
  [ITEM_STATUS.TO_PURCHASE]: STATUS_THEME.AMBER,
  [ITEM_STATUS.STILL_CANVASSING]: STATUS_THEME.VIOLET,
  [ITEM_STATUS.PURCHASED]: STATUS_THEME.BLUE,
  [ITEM_STATUS.RECEIVED]: STATUS_THEME.GREEN,
  [ITEM_STATUS.CANNOT_SOURCE]: STATUS_THEME.RED,
  [ITEM_STATUS.CANCELLED]: STATUS_THEME.MAUVE,
};

/** Statuses an item never leaves. Purchasing settled waits for every item to reach one. */
export const CLOSED_STATUSES = [
  ITEM_STATUS.AVAILABLE,
  ITEM_STATUS.RECEIVED,
  ITEM_STATUS.CANNOT_SOURCE,
  ITEM_STATUS.CANCELLED,
];

export const isClosedStatus = (status) => CLOSED_STATUSES.includes(status);

/**
 * Why the request's SOR is closed for Purchasing (`purchase_request_queue.sor_closed`), and
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
 * The SOR's Stage as a request row shows it (`purchase_request_queue`): its Flow Stage, or,
 * for an SOR registered before Sales Flows, its legacy status. Null when neither.
 */
export const requestStageLabel = (row) => row?.stage_name || STAGE_LABELS[row?.sor_status] || null;

/**
 * A Purchase Request's kind (#179): Project when it has an SOR, Direct when it
 * has none. Worked out, never stored.
 */
export const REQUEST_KIND = { PROJECT: "project", DIRECT: "direct" };

export const REQUEST_KIND_LABELS = {
  [REQUEST_KIND.PROJECT]: "Project",
  [REQUEST_KIND.DIRECT]: "Direct",
};

export const requestKind = (row) => (row?.opportunity_id ? REQUEST_KIND.PROJECT : REQUEST_KIND.DIRECT);

/** What names a request: its SOR's reference and project, or a Direct request's title. */
export function requestIdentity(row) {
  if (requestKind(row) === REQUEST_KIND.DIRECT) {
    return { reference: REQUEST_KIND_LABELS[REQUEST_KIND.DIRECT], title: row?.title || "Purchase Request" };
  }
  return { reference: row?.sales_reference || "No SOR", title: row?.project_title || "Purchase Request" };
}

/** Which side of the request a member sits on. Decides what they may change. */
export const MEMBER_SIDE = {
  PURCHASING: "purchasing",
  SALES: "sales",
  REQUESTER: "requester",
  OTHER: "other",
};

/**
 * Forward steps on the main path, for Purchasing. Purchased and Received are never chosen (#684):
 * they follow the P0 attached from Odoo, and the database refuses them. Available and To purchase
 * are chosen by hand by everyone on the deal (see `CHOOSE_BY_HAND`).
 */
const NEXT_ON_PATH = {
  [ITEM_STATUS.TO_PURCHASE]: [ITEM_STATUS.STILL_CANVASSING],
  [ITEM_STATUS.STILL_CANVASSING]: [],
  [ITEM_STATUS.PURCHASED]: [],
};

/** The ways out, open to purchasing from any open status. */
const WAYS_OUT = [ITEM_STATUS.CANNOT_SOURCE, ITEM_STATUS.CANCELLED];

/**
 * #681 — what a member may choose from a product line's status, by hand: Available or To purchase
 * from the stock check. Purchasing, the sales side and any other deal member may; a Direct request's
 * Requester has no deal. Open to be chosen again from Not checked, Available and To purchase.
 */
export const CHOOSE_BY_HAND = [ITEM_STATUS.AVAILABLE, ITEM_STATUS.TO_PURCHASE];
const CHOOSE_BY_HAND_FROM = [ITEM_STATUS.NOT_CHECKED, ITEM_STATUS.AVAILABLE, ITEM_STATUS.TO_PURCHASE];
const CHOOSE_BY_HAND_SIDES = [MEMBER_SIDE.PURCHASING, MEMBER_SIDE.SALES, MEMBER_SIDE.OTHER];

/**
 * Still canvassing follows a Canvass, Purchased and Received follow the attached P0 (#684): none is
 * chosen from the status menu, and the database refuses them by hand.
 * Cannot source is Purchasing's alone.
 */
export const NOT_FROM_THE_MENU = [ITEM_STATUS.STILL_CANVASSING];

/**
 * The statuses a member on `side` may move an item to from `status`; this mirrors the database.
 *
 * Purchasing walks the path and takes any way out; the sales side and a Direct request's Requester
 * may only cancel; anyone on the deal may choose Available or To purchase (#681). A closed item
 * goes nowhere, except that Available may be chosen again (it clears a "Now x free of y" warning).
 */
export function allowedTransitions(status, side) {
  if (!ITEM_STATUSES.includes(status)) return [];
  const byHand =
    CHOOSE_BY_HAND_SIDES.includes(side) && CHOOSE_BY_HAND_FROM.includes(status)
      ? CHOOSE_BY_HAND.filter((to) => to !== status || to === ITEM_STATUS.AVAILABLE)
      : [];
  if (isClosedStatus(status)) return byHand;
  if (side === MEMBER_SIDE.PURCHASING) return [...byHand, ...(NEXT_ON_PATH[status] ?? []), ...WAYS_OUT];
  if (side === MEMBER_SIDE.SALES) return [...byHand, ITEM_STATUS.CANCELLED];
  if (side === MEMBER_SIDE.REQUESTER) return [ITEM_STATUS.CANCELLED];
  return byHand;
}

/**
 * #681 — the line's "Now x free of y" warning, or null. A fresh stock check found fewer free than
 * an Available line needs; any status choice clears it.
 */
export function stockWarning(item) {
  if (!item || item.status !== ITEM_STATUS.AVAILABLE) return null;
  if (item.stock_short_free == null || item.stock_short_needed == null) return null;
  const free = Number(item.stock_short_free);
  const needed = Number(item.stock_short_needed);
  return { free, needed, label: `Now ${free} free of ${needed}` };
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
 * never allowed, rather than quietly calling it Not checked.
 */
const LEGACY_OUTCOME_STATUS = {
  [PROCUREMENT_OUTCOME.IN_PROGRESS]: ITEM_STATUS.STILL_CANVASSING,
  [PROCUREMENT_OUTCOME.PURCHASED]: ITEM_STATUS.PURCHASED,
  [PROCUREMENT_OUTCOME.DELIVERED]: ITEM_STATUS.RECEIVED,
  [PROCUREMENT_OUTCOME.ALREADY_EXISTS]: ITEM_STATUS.AVAILABLE,
  [PROCUREMENT_OUTCOME.SUBSTITUTED]: ITEM_STATUS.CANCELLED,
  [PROCUREMENT_OUTCOME.UNAVAILABLE]: ITEM_STATUS.CANNOT_SOURCE,
};

export function legacyOutcomeToStatus(outcome) {
  if (outcome == null) return ITEM_STATUS.NOT_CHECKED;
  const status = LEGACY_OUTCOME_STATUS[normalizeOutcome(outcome)];
  if (!status) throw new Error(`Unknown legacy procurement outcome: ${outcome}`);
  return status;
}
