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
 *   REFRESH_FAILED    Odoo answered but the copy couldn't be stored (a refresh only)
 */
export const IPAS_ERROR = {
  INVALID: "IPAS_INVALID",
  PO_INVALID: "IPAS_PO_INVALID",
  PO_NOT_FOUND: "IPAS_PO_NOT_FOUND",
  ODOO_UNAVAILABLE: "IPAS_ODOO_UNAVAILABLE",
  REFRESH_FAILED: "IPAS_REFRESH_FAILED",
};

/**
 * The Odoo fields Purchasing may override (#243), by the name the RPCs take:
 * the column the override lives in and the label the page uses. Currency,
 * Supplier, item lines and Brand are deliberately absent: a wrong one is fixed
 * on the PO in Odoo.
 */
export const IPAS_OVERRIDE = {
  ENTITY: "entity",
  SOURCE_DOC: "source_doc",
  ANALYTIC: "analytic",
};

export const IPAS_OVERRIDE_FIELDS = {
  [IPAS_OVERRIDE.ENTITY]: { column: "entity_override", label: "Entity" },
  [IPAS_OVERRIDE.SOURCE_DOC]: { column: "source_doc_override", label: "Source Doc. Odoo" },
  [IPAS_OVERRIDE.ANALYTIC]: { column: "analytic_override", label: "Analytic Dist." },
};

/**
 * The header values Purchasing types or picks (ipas_set_header's keys). Contact
 * and P.I # are also filled from Odoo while blank (#243); the rest are #244's:
 * P.I/QT Amount (typed), the one freight service, how Landed Cost is spread,
 * and the computation status.
 */
export const IPAS_HEADER_FIELD = {
  SUPPLIER_CONTACT: "supplier_contact",
  PI_NUMBER: "pi_number",
  PI_QT_AMOUNT: "pi_qt_amount",
  FREIGHT_SERVICE: "freight_service_id",
  LANDED_COST_SPLIT: "landed_cost_split",
  COMPUTATION_STATUS: "computation_status",
};

/** Payment kinds (ipas_payments.kind). */
export const IPAS_PAYMENT_KIND = {
  DOWN_PAYMENT: "down_payment",
  PAYMENT: "payment",
  FULL_PAYMENT: "full_payment",
  SHIPPING_FEE: "shipping_fee",
};

export const IPAS_PAYMENT_KINDS = [
  IPAS_PAYMENT_KIND.DOWN_PAYMENT,
  IPAS_PAYMENT_KIND.PAYMENT,
  IPAS_PAYMENT_KIND.FULL_PAYMENT,
  IPAS_PAYMENT_KIND.SHIPPING_FEE,
];

export const IPAS_PAYMENT_KIND_LABELS = {
  [IPAS_PAYMENT_KIND.DOWN_PAYMENT]: "Down payment",
  [IPAS_PAYMENT_KIND.PAYMENT]: "Payment",
  [IPAS_PAYMENT_KIND.FULL_PAYMENT]: "Full payment",
  [IPAS_PAYMENT_KIND.SHIPPING_FEE]: "Shipping fee",
};

/** How charges, charge fees and shipping fees are spread over the item lines. */
export const IPAS_LANDED_COST_SPLIT = {
  VALUE: "value",
  QUANTITY: "quantity",
  EQUAL: "equal",
};

export const IPAS_LANDED_COST_SPLITS = [
  IPAS_LANDED_COST_SPLIT.VALUE,
  IPAS_LANDED_COST_SPLIT.QUANTITY,
  IPAS_LANDED_COST_SPLIT.EQUAL,
];

export const IPAS_LANDED_COST_SPLIT_LABELS = {
  [IPAS_LANDED_COST_SPLIT.VALUE]: "By value",
  [IPAS_LANDED_COST_SPLIT.QUANTITY]: "By quantity",
  [IPAS_LANDED_COST_SPLIT.EQUAL]: "Equally",
};

/** Where the costing stands (ipas.computation_status), in order. */
export const IPAS_COMPUTATION_STATUS = {
  ENCODING: "encoding",
  ENCODED: "encoded",
  COSTS_COMPLETE: "costs_complete",
  CHECKED: "checked",
};

export const IPAS_COMPUTATION_STATUSES = [
  IPAS_COMPUTATION_STATUS.ENCODING,
  IPAS_COMPUTATION_STATUS.ENCODED,
  IPAS_COMPUTATION_STATUS.COSTS_COMPLETE,
  IPAS_COMPUTATION_STATUS.CHECKED,
];

export const IPAS_COMPUTATION_STATUS_LABELS = {
  [IPAS_COMPUTATION_STATUS.ENCODING]: "Encoding",
  [IPAS_COMPUTATION_STATUS.ENCODED]: "Encoded",
  [IPAS_COMPUTATION_STATUS.COSTS_COMPLETE]: "Costs complete",
  [IPAS_COMPUTATION_STATUS.CHECKED]: "Checked by",
};

/** Landed Cost is `unavailable`, or `provisional` until Costs complete, then `final`. */
export const IPAS_LANDED_COST_STATUS = {
  UNAVAILABLE: "unavailable",
  PROVISIONAL: "provisional",
  FINAL: "final",
};

/** Why Landed Cost isn't available. */
export const IPAS_LANDED_COST_REASON = {
  NO_PAYMENTS: "no_payments",
  NO_LINES: "no_lines",
};

/** The option lists (ipas_options.list). Options are deactivated, never deleted. */
export const IPAS_OPTION_LIST = {
  PAYMENT_METHOD: "payment_method",
  CHARGE_KIND: "charge_kind",
  FREIGHT_SERVICE: "freight_service",
  DOCUMENT_KIND: "document_kind",
  ITEM_LOCATION: "item_location",
};

/** The lists IPAS settings edits today, in tab order. Later tickets add theirs. */
export const IPAS_OPTION_LISTS = [
  IPAS_OPTION_LIST.PAYMENT_METHOD,
  IPAS_OPTION_LIST.CHARGE_KIND,
  IPAS_OPTION_LIST.FREIGHT_SERVICE,
];

export const IPAS_OPTION_LIST_LABELS = {
  [IPAS_OPTION_LIST.PAYMENT_METHOD]: "Payment methods",
  [IPAS_OPTION_LIST.CHARGE_KIND]: "Charge kinds",
  [IPAS_OPTION_LIST.FREIGHT_SERVICE]: "Freight services",
  [IPAS_OPTION_LIST.DOCUMENT_KIND]: "Document kinds",
  [IPAS_OPTION_LIST.ITEM_LOCATION]: "Item locations",
};

/** What one option of each list is called, singular. */
export const IPAS_OPTION_LIST_NOUNS = {
  [IPAS_OPTION_LIST.PAYMENT_METHOD]: "payment method",
  [IPAS_OPTION_LIST.CHARGE_KIND]: "charge kind",
  [IPAS_OPTION_LIST.FREIGHT_SERVICE]: "freight service",
  [IPAS_OPTION_LIST.DOCUMENT_KIND]: "document kind",
  [IPAS_OPTION_LIST.ITEM_LOCATION]: "item location",
};

/**
 * Warnings the page raises from the stored copy. None of them changes the IPAS:
 * a PO cancelled in Odoo leaves it open, an S-number mismatch is only said, and
 * a filed copy never moves.
 */
export const IPAS_WARNING = {
  PO_CANCELLED_IN_ODOO: "po_cancelled_in_odoo",
  SOR_MISMATCH: "sor_mismatch",
  ODOO_CHANGED_SINCE_FILING: "odoo_changed_since_filing",
};

/** Notification type written when a PO change clears section 1 and 3 approvals. */
export const IPAS_NOTIFICATION = {
  PO_CHANGED: "IPAS_PO_CHANGED",
  ACCOUNT_FLAGGED: "IPAS_ACCOUNT_FLAGGED",
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
  override_set: "Override set",
  override_reset: "Reset to Odoo",
  header_changed: "Header changed",
  filled_from_odoo: "Filled from Odoo",
  odoo_copy_changed: "PO changed in Odoo",
  odoo_changed_since_filing: "Odoo has changed since filing",
  approvals_cleared: "Approvals cleared",
  payment_added: "Payment added",
  payment_changed: "Payment changed",
  payment_removed: "Payment removed",
  charge_added: "Charge added",
  charge_changed: "Charge changed",
  charge_removed: "Charge removed",
  bank_details_set: "Bank details typed",
  bank_details_changed: "Bank details changed",
  account_flagged: "Account # flagged",
};
