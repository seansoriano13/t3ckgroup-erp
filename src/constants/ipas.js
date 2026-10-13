/**
 * IPAS vocabulary (spec #241, tickets #242 onward).
 *
 * The stored values mirror the CHECK constraints in
 * supabase/migrations/20261013100100_ipas.sql; the labels are what the screens
 * and the printed form say. CONTEXT.md's IPAS entry is the language source.
 */

import { STATUS_THEME } from "./statusTheme";

/** `TGIPAS_` and a zero-padded sequence, three digits minimum (TGIPAS_048). */
export const IPAS_NUMBER_PREFIX = "TGIPAS_";

export const IPAS_PRIORITY = {
  VERY_HIGH: "very_high",
  HIGH: "high",
  MEDIUM: "medium",
};

export const IPAS_PRIORITIES = [IPAS_PRIORITY.VERY_HIGH, IPAS_PRIORITY.HIGH, IPAS_PRIORITY.MEDIUM];

export const IPAS_PRIORITY_LABELS = {
  [IPAS_PRIORITY.VERY_HIGH]: "Very High",
  [IPAS_PRIORITY.HIGH]: "High",
  [IPAS_PRIORITY.MEDIUM]: "Medium",
};

export const IPAS_SOURCE = {
  IMPORT: "import",
  LOCAL: "local",
};

export const IPAS_SOURCES = [IPAS_SOURCE.IMPORT, IPAS_SOURCE.LOCAL];

export const IPAS_SOURCE_LABELS = {
  [IPAS_SOURCE.IMPORT]: "Import",
  [IPAS_SOURCE.LOCAL]: "Local",
};

export const IPAS_PURPOSE = {
  PROJECT: "project",
  INVENTORY: "inventory",
  SUPPLIES: "supplies",
  EVENTS: "events",
};

export const IPAS_PURPOSES = [
  IPAS_PURPOSE.PROJECT,
  IPAS_PURPOSE.INVENTORY,
  IPAS_PURPOSE.SUPPLIES,
  IPAS_PURPOSE.EVENTS,
];

export const IPAS_PURPOSE_LABELS = {
  [IPAS_PURPOSE.PROJECT]: "Project",
  [IPAS_PURPOSE.INVENTORY]: "Inventory",
  [IPAS_PURPOSE.SUPPLIES]: "Supplies",
  [IPAS_PURPOSE.EVENTS]: "Events",
};

export const IPAS_STATE = {
  OPEN: "open",
  FILED: "filed",
  CANCELLED: "cancelled",
};

export const IPAS_STATE_LABELS = {
  [IPAS_STATE.OPEN]: "Open",
  [IPAS_STATE.FILED]: "Filed",
  [IPAS_STATE.CANCELLED]: "Cancelled",
};

/** The badge colour of each state (StatusBadge `theme`). */
export const IPAS_STATE_THEME = {
  [IPAS_STATE.OPEN]: STATUS_THEME.AMBER,
  [IPAS_STATE.FILED]: STATUS_THEME.GREEN,
  [IPAS_STATE.CANCELLED]: STATUS_THEME.MAUVE,
};

/** The list's state filter: one state, or every IPAS. */
export const IPAS_STATE_FILTER_ALL = "all";

/**
 * Why a PO couldn't become an IPAS, for the screen to say apart:
 *   PO_INVALID        the number isn't an Odoo PO ("P" then digits)
 *   PO_NOT_FOUND      Odoo answered and has no such PO
 *   ODOO_UNAVAILABLE  Odoo couldn't be asked; the PO may well exist
 */
export const IPAS_ERROR = {
  INVALID: "IPAS_INVALID",
  PO_INVALID: "IPAS_PO_INVALID",
  PO_NOT_FOUND: "IPAS_PO_NOT_FOUND",
  ODOO_UNAVAILABLE: "IPAS_ODOO_UNAVAILABLE",
};

/** The Odoo PO's own state, as the page words it. */
export const ODOO_PO_STATE_LABELS = {
  draft: "RFQ",
  sent: "RFQ sent",
  "to approve": "To approve",
  purchase: "Purchase order",
  done: "Locked",
  cancel: "Cancelled in Odoo",
};

/** The event kinds the history shows (ipas_events.kind). */
export const IPAS_EVENT_LABELS = {
  created: "Raised",
  cancelled: "Cancelled",
  purpose_sors_changed: "Purpose and SORs changed",
};
