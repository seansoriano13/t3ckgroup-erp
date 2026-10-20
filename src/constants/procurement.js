/**
 * SOR → Purchasing procurement constants.
 *
 * A request is raised when a client asks for a product the company does not
 * carry. It is deliberately NOT tied to the SOR's product list: that list is
 * pulled from the Odoo sales order, so everything in it exists in Odoo already.
 * The product that needs sourcing is the one that could never be on it.
 *
 * Purchasing sources it, creates the product in Odoo, raises a PO, and records
 * the result per requested product.
 *
 * See docs/sor-procurement-flow-decisions.md for why the flow is shaped this
 * way. These values are mirrored by CHECK constraints in migration 0017.
 */

import { STATUS_THEME } from "./statusTheme";

/**
 * Per-item outcomes. Deliberately not task statuses — TASK_STATUS is untouched
 * by this flow. A row with no outcome is unresolved, and the purchasing task
 * closes when none are left.
 */
export const PROCUREMENT_OUTCOME = {
  IN_PROGRESS: "IN_PROGRESS",
  PURCHASED: "PURCHASED",
  DELIVERED: "DELIVERED",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  SUBSTITUTED: "SUBSTITUTED",
  UNAVAILABLE: "UNAVAILABLE",
};

/**
 * Outcomes written by an earlier build that are still on rows in the database.
 *
 * These are deliberately NOT members of PROCUREMENT_OUTCOME. An alias sitting
 * inside the enum (`ON_ORDER: "PURCHASED"`) makes `Object.values` yield
 * "PURCHASED" twice and no "ON_ORDER" at all, so anything iterating the enum
 * to build a dropdown, a validator or a tally silently sees the wrong set.
 * Migration 0019 backfills these rows, but keeps the value legal, so reads
 * still have to cope with one until every database has been migrated.
 */
export const LEGACY_PROCUREMENT_OUTCOME = {
  ON_ORDER: PROCUREMENT_OUTCOME.PURCHASED,
};

/** Maps a stored outcome onto the current vocabulary. */
export const normalizeOutcome = (outcome) =>
  LEGACY_PROCUREMENT_OUTCOME[outcome] || outcome || null;

/**
 * Progression:
 *   1. IN_PROGRESS (Canvassing suppliers / comparing quotes)
 *   2. PURCHASED   (PO raised in Odoo, goods in transit from vendor)
 *   3. DELIVERED   (Goods physically arrived at warehouse/office, ready for client delivery)
 *
 * Alternative Terminal States:
 *   - ALREADY_EXISTS (Found in catalog under existing SKU)
 *   - SUBSTITUTED    (Alternative product sourced; sales re-prices)
 *   - UNAVAILABLE    (Cannot be sourced)
 */
export const PROCUREMENT_OUTCOMES = [
  {
    value: PROCUREMENT_OUTCOME.IN_PROGRESS,
    label: "In progress",
    hint: "Actively canvassing suppliers / comparing quotes. No PO yet.",
    requiresPo: false,
    isTerminal: false,
  },
  {
    value: PROCUREMENT_OUTCOME.PURCHASED,
    label: "Purchased",
    hint: "PO raised in Odoo. In transit from supplier.",
    requiresPo: true,
    isTerminal: false,
  },
  {
    value: PROCUREMENT_OUTCOME.DELIVERED,
    label: "Delivered",
    hint: "Arrived at company warehouse/office. Ready for delivery to client.",
    requiresPo: true,
    isTerminal: true,
  },
  {
    value: PROCUREMENT_OUTCOME.ALREADY_EXISTS,
    label: "Already in Odoo",
    hint: "Exists under a different name. Nothing bought.",
    requiresPo: false,
    isTerminal: true,
  },
  {
    value: PROCUREMENT_OUTCOME.SUBSTITUTED,
    label: "Substituted",
    hint: "A different product was sourced. Sales must re-price.",
    requiresPo: true,
    isTerminal: true,
  },
  {
    value: PROCUREMENT_OUTCOME.UNAVAILABLE,
    label: "Cannot source",
    hint: "Not obtainable. Sales needs to drop or replace the line.",
    requiresPo: false,
    isTerminal: true,
  },
];

/** Extends a map keyed by outcome so every legacy value resolves too. */
const withLegacyKeys = (byOutcome) => ({
  ...byOutcome,
  ...Object.fromEntries(
    Object.entries(LEGACY_PROCUREMENT_OUTCOME).map(([legacy, current]) => [
      legacy,
      byOutcome[current],
    ]),
  ),
});

export const PROCUREMENT_OUTCOME_LABELS = withLegacyKeys(
  Object.fromEntries(PROCUREMENT_OUTCOMES.map((o) => [o.value, o.label])),
);

/**
 * Returns a display-friendly outcome badge representation.
 * Unresolved requests (no outcome recorded) display as "Pending" (AMBER theme).
 */
export function displayOutcome(request) {
  const outcome = normalizeOutcome(request?.outcome);
  if (outcome) {
    return {
      raw: outcome,
      label: PROCUREMENT_OUTCOME_LABELS[outcome] || outcome,
    };
  }
  return { raw: "PENDING", label: "Pending" };
}

export const PROCUREMENT_OUTCOME_THEME = withLegacyKeys({
  [PROCUREMENT_OUTCOME.IN_PROGRESS]: STATUS_THEME.AMBER,
  [PROCUREMENT_OUTCOME.PURCHASED]: STATUS_THEME.BLUE,
  [PROCUREMENT_OUTCOME.DELIVERED]: STATUS_THEME.GREEN,
  [PROCUREMENT_OUTCOME.ALREADY_EXISTS]: STATUS_THEME.GREEN,
  [PROCUREMENT_OUTCOME.SUBSTITUTED]: STATUS_THEME.VIOLET,
  [PROCUREMENT_OUTCOME.UNAVAILABLE]: STATUS_THEME.RED,
});

/** Display labels an earlier build wrote into badges instead of the value. */
const LEGACY_OUTCOME_DISPLAY_LABELS = {
  "ON ORDER": PROCUREMENT_OUTCOME.PURCHASED,
};

/**
 * The same palette, keyed by uppercased display label.
 *
 * `StatusBadge` is sometimes handed what the user reads ("Cannot source")
 * rather than what is stored ("UNAVAILABLE"). Deriving the label keys from
 * PROCUREMENT_OUTCOMES keeps the two in step; they used to be hand-typed as
 * switch cases in status.js, where renaming a label silently lost its colour.
 */
export const PROCUREMENT_LABEL_THEME = {
  ...Object.fromEntries(
    PROCUREMENT_OUTCOMES.map((o) => [
      o.label.toUpperCase(),
      PROCUREMENT_OUTCOME_THEME[o.value],
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(LEGACY_OUTCOME_DISPLAY_LABELS).map(([label, value]) => [
      label,
      PROCUREMENT_OUTCOME_THEME[value],
    ]),
  ),
};

/** Whether an outcome is a final terminal state. */
export const isTerminalOutcome = (outcome) => {
  const value = normalizeOutcome(outcome);
  if (!value) return false;
  const match = PROCUREMENT_OUTCOMES.find((o) => o.value === value);
  return match ? match.isTerminal : false;
};

/** Whether an outcome is meaningless without a PO number recorded against it. */
export const outcomeRequiresPo = (outcome) =>
  PROCUREMENT_OUTCOMES.find((o) => o.value === normalizeOutcome(outcome))
    ?.requiresPo === true;

/** Result of checking a PO number against Odoo's purchase.order. */
export const PO_VERIFICATION = {
  UNVERIFIED: "UNVERIFIED",
  VERIFIED: "VERIFIED",
  PENDING: "PENDING_VERIFICATION",
  NOT_FOUND: "NOT_FOUND",
};

export const PO_VERIFICATION_LABELS = {
  [PO_VERIFICATION.UNVERIFIED]: "Not checked",
  [PO_VERIFICATION.VERIFIED]: "Confirmed in Odoo",
  [PO_VERIFICATION.PENDING]: "Not checked — Odoo did not answer",
  [PO_VERIFICATION.NOT_FOUND]: "Not found in Odoo",
};

// ── Odoo purchase order reference ───────────────────────────────────────────
// Odoo numbers a confirmed purchase.order P0####, the same shape as the S0####
// it gives a sale.order. Kept permissive on width, matching how
// SALES_REFERENCE_PATTERN treats the S-number.

export const PO_NUMBER_PATTERN = /^P\d+$/;

export const PO_NUMBER_HINT =
  'PO Number must be the Odoo purchase order number — "P" followed by digits, e.g. P01234.';

export const normalizePoNumber = (value) => (value || "").trim().toUpperCase();

export const isValidPoNumber = (value) =>
  PO_NUMBER_PATTERN.test(normalizePoNumber(value));

/**
 * The team this panel exists to reach.
 *
 * Hardcoding a team name is normally a smell, but the whole point of this
 * control is to reach purchasing — so the ranking is domain truth, not a
 * layout hack. Matched case-insensitively against sub_department first and
 * department second, and used only for *ordering* suggestions: every employee
 * stays reachable, purchasing just stops being buried behind 36 other people.
 */
export const PROCUREMENT_TEAM = "PURCHASING";

/** Ranks a recipient for the request field. Lower sorts first. */
export function procurementAffinity(recipient) {
  const team = PROCUREMENT_TEAM.toLowerCase();
  const sub = (recipient?.subDepartment || "").toLowerCase();
  const dept = (recipient?.department || "").toLowerCase();
  if (sub === team || dept === team) return 0;
  return 1;
}

/**
 * Units a request can be counted in. Purchasing cannot source without knowing
 * how many of what, and a free-text unit produces "pc"/"pcs"/"piece" in the
 * same column. Ordered by how often they come up rather than alphabetically.
 */
export const REQUEST_UNITS = [
  "unit",
  "pc",
  "set",
  "box",
  "roll",
  "meter",
  "kg",
  "pair",
  "lot",
];

/** A request is answered once purchasing has recorded a definitive outcome (Purchased, Delivered, or Alternative). */
export const isResolved = (request) => {
  const outcome = normalizeOutcome(request?.outcome);
  return !!outcome && outcome !== PROCUREMENT_OUTCOME.IN_PROGRESS;
};

/** Returns { total, resolved } for a set of requests — drives the "2/3" rail. */
export function countResolved(requests = []) {
  return {
    total: requests.length,
    resolved: requests.filter(isResolved).length,
  };
}

// There is deliberately no "unsourceable value" figure. An earlier draft
// warned that refused products inflated the opportunity's Expected Value —
// that was a consequence of flagging existing SOR lines. A requested product
// was never a line item and never contributed to expected_value, so nothing is
// inflated and there is nothing to reconcile.

/** Requests still awaiting an outcome, for the stage-gate warning. */
export const openRequests = (requests = []) => requests.filter((r) => !isResolved(r));

/**
 * Whole days a request has been waiting for an answer (issue #39).
 *
 * `now` is an argument rather than a call to Date.now() so the queue's age
 * column is a function of its inputs and can be tested without freezing a
 * clock. Returns null when there is nothing to measure from — a missing or
 * unparseable timestamp is not "0 days old", and rendering it as such would
 * quietly tell a purchaser the oldest thing on their list arrived today.
 */
export function daysWaiting(request, now = Date.now()) {
  const raised = Date.parse(request?.created_at ?? "");
  if (Number.isNaN(raised)) return null;
  const elapsed = Number(now) - raised;
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Math.floor(elapsed / 86_400_000);
}
