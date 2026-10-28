/**
 * IPAS vocabulary (spec #241, tickets #242 onward).
 *
 * The stored values mirror the CHECK constraints in
 * supabase/migrations/20261013100100_ipas.sql; the labels are what the screens
 * and the printed form say. CONTEXT.md's IPAS entry is the language source.
 */

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

// The badge colour of each state lives with every other status colour, in
// constants/status.js (IPAS_STATUS_THEME).

/** The list's state filter: one state, or every IPAS. */
export const IPAS_STATE_FILTER_ALL = "all";

/**
 * The IPAS Status (spec #595, #597): the six steps the sheet kept, worked out from
 * the IPAS by utils/ipasFigures.js and never stored. Only On-Hold is set by a person
 * (`ipas.on_hold`). A cancelled IPAS has none. Separate from the state above and from
 * the Computation status. In the order the filter lists them.
 */
export const IPAS_STATUS = {
  PENDING: "pending",
  REQUESTED: "requested",
  ONGOING: "ongoing",
  PAID: "paid",
  DONE: "done",
  ON_HOLD: "on_hold",
};

export const IPAS_STATUSES = Object.values(IPAS_STATUS);

export const IPAS_STATUS_LABELS = {
  [IPAS_STATUS.PENDING]: "Pending",
  [IPAS_STATUS.REQUESTED]: "Requested",
  [IPAS_STATUS.ONGOING]: "Ongoing",
  [IPAS_STATUS.PAID]: "Paid",
  [IPAS_STATUS.DONE]: "Done",
  [IPAS_STATUS.ON_HOLD]: "On-Hold",
};

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
  OPTION_ON_FILED: "IPAS_OPTION_ON_FILED",
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
 * and the computation status. Section 2's two ticks (#241) are booleans.
 */
export const IPAS_HEADER_FIELD = {
  SUPPLIER_CONTACT: "supplier_contact",
  PI_NUMBER: "pi_number",
  PI_QT_AMOUNT: "pi_qt_amount",
  FREIGHT_SERVICE: "freight_service_id",
  LANDED_COST_SPLIT: "landed_cost_split",
  COMPUTATION_STATUS: "computation_status",
  GOOGLE_SHEET: "google_sheet",
  GANTT_CHART: "gantt_chart",
  REMARKS: "remarks",
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
  LC_GS_DONE: "lc_gs_done",
  LC_ODOO_DONE: "lc_odoo_done",
};

export const IPAS_COMPUTATION_STATUSES = [
  IPAS_COMPUTATION_STATUS.ENCODING,
  IPAS_COMPUTATION_STATUS.ENCODED,
  IPAS_COMPUTATION_STATUS.LC_GS_DONE,
  IPAS_COMPUTATION_STATUS.LC_ODOO_DONE,
];

export const IPAS_COMPUTATION_STATUS_LABELS = {
  [IPAS_COMPUTATION_STATUS.ENCODING]: "Encoding",
  [IPAS_COMPUTATION_STATUS.ENCODED]: "Encoded",
  [IPAS_COMPUTATION_STATUS.LC_GS_DONE]: "LC GS Done",
  [IPAS_COMPUTATION_STATUS.LC_ODOO_DONE]: "LC Odoo Done",
  // Stored in history before LC GS Done and LC Odoo Done replaced it.
  costs_complete: "LC Odoo Done",
  // The old last step, gone since section 3 became a sign-off (#586). Kept so history lines
  // written before then still read.
  checked: "Checked by",
};

/**
 * The IPAS list's costing filter also finds IPAS whose section 3 (stored 6) is approved.
 * Not a Computation status: the list matches it against the live sign-off (#586).
 */
export const IPAS_SECTION_3_APPROVED_FILTER = "section_3_approved";

/**
 * Landed Cost is `unavailable`, or `provisional` until LC Odoo Done, then `final`. While a
 * foreign-currency payment's "Pesos taken from the bank" is blank it is also an estimate
 * (`estimate: true` beside `provisional`, #604).
 */
export const IPAS_LANDED_COST_STATUS = {
  UNAVAILABLE: "unavailable",
  PROVISIONAL: "provisional",
  FINAL: "final",
};

/** Why Landed Cost isn't available. */
export const IPAS_LANDED_COST_REASON = {
  NO_PAYMENTS: "no_payments",
  NO_LINES: "no_lines",
  /** A payment's pesos are blank and no Reference Rate exists on or before its date (#604). */
  NO_REFERENCE_RATE: "no_reference_rate",
};

/** The option lists (ipas_options.list). Options are deactivated, never deleted. */
export const IPAS_OPTION_LIST = {
  PAYMENT_METHOD: "payment_method",
  CHARGE_KIND: "charge_kind",
  FREIGHT_SERVICE: "freight_service",
  DOCUMENT_KIND: "document_kind",
  ITEM_LOCATION: "item_location",
};

/** The lists IPAS settings edits, in tab order. */
export const IPAS_OPTION_LISTS = [
  IPAS_OPTION_LIST.PAYMENT_METHOD,
  IPAS_OPTION_LIST.CHARGE_KIND,
  IPAS_OPTION_LIST.FREIGHT_SERVICE,
  IPAS_OPTION_LIST.DOCUMENT_KIND,
  IPAS_OPTION_LIST.ITEM_LOCATION,
];

/**
 * Which Source a document kind is suggested for (ipas_options.applies_to), and
 * whether it is documentation, filing or both (used_for). #246.
 */
export const IPAS_DOCUMENT_APPLIES_TO = {
  IMPORT: "import",
  LOCAL: "local",
  BOTH: "both",
};

export const IPAS_DOCUMENT_APPLIES_TO_VALUES = [
  IPAS_DOCUMENT_APPLIES_TO.IMPORT,
  IPAS_DOCUMENT_APPLIES_TO.LOCAL,
  IPAS_DOCUMENT_APPLIES_TO.BOTH,
];

export const IPAS_DOCUMENT_APPLIES_TO_LABELS = {
  [IPAS_DOCUMENT_APPLIES_TO.IMPORT]: "Import",
  [IPAS_DOCUMENT_APPLIES_TO.LOCAL]: "Local",
  [IPAS_DOCUMENT_APPLIES_TO.BOTH]: "Import and Local",
};

export const IPAS_DOCUMENT_USED_FOR = {
  DOCUMENTATION: "documentation",
  FILING: "filing",
  BOTH: "both",
};

export const IPAS_DOCUMENT_USED_FOR_VALUES = [
  IPAS_DOCUMENT_USED_FOR.DOCUMENTATION,
  IPAS_DOCUMENT_USED_FOR.FILING,
  IPAS_DOCUMENT_USED_FOR.BOTH,
];

export const IPAS_DOCUMENT_USED_FOR_LABELS = {
  [IPAS_DOCUMENT_USED_FOR.DOCUMENTATION]: "Documentation",
  [IPAS_DOCUMENT_USED_FOR.FILING]: "Filing",
  [IPAS_DOCUMENT_USED_FOR.BOTH]: "Documentation and filing",
};

/** The two ticks on a document row: each belongs to one department. */
export const IPAS_TICK_SIDE = {
  PURCHASING: "purchasing",
  FINANCE: "finance",
};

export const IPAS_TICK_SIDES = [IPAS_TICK_SIDE.PURCHASING, IPAS_TICK_SIDE.FINANCE];

export const IPAS_TICK_SIDE_LABELS = {
  [IPAS_TICK_SIDE.PURCHASING]: "Purchasing has it",
  [IPAS_TICK_SIDE.FINANCE]: "Finance has it",
};

/**
 * Supplier Origin (#246): four typed dates, Import only. `column` is the ipas
 * column and the RPC key, `field` the camelCase name the service takes.
 */
export const IPAS_SUPPLIER_ORIGIN_FIELDS = [
  { field: "shippedOut", column: "shipped_out_on", label: "Shipped Out" },
  { field: "onboard", column: "onboard_on", label: "Onboard" },
  { field: "arrivedInPh", column: "arrived_in_ph_on", label: "Arrived in PH" },
  { field: "arrivedInWhs", column: "arrived_in_whs_on", label: "Arrived in Whs." },
];

/** The buyer-track statuses a person types (ipas_set_typed_status). */
export const IPAS_TYPED_STATUS = {
  IMPORT_CLEARANCE: "import_clearance",
  DELIVERED: "delivered",
};

export const IPAS_TYPED_STATUSES = [IPAS_TYPED_STATUS.IMPORT_CLEARANCE, IPAS_TYPED_STATUS.DELIVERED];

export const IPAS_TYPED_STATUS_LABELS = {
  [IPAS_TYPED_STATUS.IMPORT_CLEARANCE]: "Import Clearance",
  [IPAS_TYPED_STATUS.DELIVERED]: "Delivered",
};

/**
 * Where a buyer-track status came from, so the page and the print can say so:
 *   odoo     read from the Odoo PO ("stamped from Odoo")
 *   derived  worked out from other rows (With P.O.P: a payment carries proof)
 *   typed    a person typed the date
 *   stamped  a person stamped it (Actual Checking, by Purchasing)
 */
export const IPAS_STATUS_SOURCE = {
  ODOO: "odoo",
  DERIVED: "derived",
  TYPED: "typed",
  STAMPED: "stamped",
};

/**
 * The buyer track's items by key, as the SOR's IPAS summary names them
 * (`ipas_summaries_for_sor` returns the key and the tick, never a label).
 */
export const IPAS_BUYER_TRACK_LABELS = {
  purchase_order: "Purchase Order",
  with_pop: "With P.O.P",
  import_clearance: "Import Clearance",
  delivered: "Delivered",
  received_in_odoo: "Received in Odoo",
  create_bill: "Create Bill",
  actual_checking: "Actual Checking",
};

export const IPAS_OPTION_LIST_LABELS = {
  [IPAS_OPTION_LIST.PAYMENT_METHOD]: "Payment methods",
  [IPAS_OPTION_LIST.CHARGE_KIND]: "Charge kinds",
  [IPAS_OPTION_LIST.FREIGHT_SERVICE]: "Freight services",
  [IPAS_OPTION_LIST.DOCUMENT_KIND]: "Document kinds",
  [IPAS_OPTION_LIST.ITEM_LOCATION]: "Item locations",
  // The Transmittal lists (#252) are edited on the same screen.
  transmittal_product: "Transmittal products",
  transmittal_reference: "Transmittal reference checklist",
};

/** What one option of each list is called, singular. */
export const IPAS_OPTION_LIST_NOUNS = {
  [IPAS_OPTION_LIST.PAYMENT_METHOD]: "payment method",
  [IPAS_OPTION_LIST.CHARGE_KIND]: "charge kind",
  [IPAS_OPTION_LIST.FREIGHT_SERVICE]: "freight service",
  [IPAS_OPTION_LIST.DOCUMENT_KIND]: "document kind",
  [IPAS_OPTION_LIST.ITEM_LOCATION]: "item location",
  transmittal_product: "Transmittal product",
  transmittal_reference: "Transmittal reference",
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

/**
 * Notification types: PO_CHANGED when a change clears the section 1 and 3
 * approvals (#243), ACCOUNT_FLAGGED when it clears the section 2 approval (#245, #587); SIGNOFF_READY when a section is
 * Prepared and waits for its approval list, SENT_BACK when a signer returns a
 * section to its preparer (#247). SECTION_7_READY goes to the next section 7
 * list as each step is given (#248). All route to the IPAS (notificationRouter).
 */
export const IPAS_NOTIFICATION = {
  PO_CHANGED: "IPAS_PO_CHANGED",
  ACCOUNT_FLAGGED: "IPAS_ACCOUNT_FLAGGED",
  SIGNOFF_READY: "IPAS_SIGNOFF_READY",
  SENT_BACK: "IPAS_SENT_BACK",
  APPROVAL_UNDONE: "IPAS_APPROVAL_UNDONE",
  SECTION_7_READY: "IPAS_SECTION_7_READY",
  // Written by the database (#591) when a Landed Cost change clears section 3.
  SECTION_3_CLEARED: "IPAS_SECTION_3_CLEARED",
};

/**
 * Sign-offs (#247, #248, spec #241). A sign-off is a section and a role.
 * Sections 1 and 3 are Prepared, then Approved; section 7 is Received, then
 * Noted and Checked in any order, then Approved, which files the IPAS.
 * `IPAS_SIGNOFF_SECTIONS` is the sections the service's `sign` takes;
 * `IPAS_SEND_BACK_SECTIONS` the ones that can be sent back: 1 and 3 return their
 * Prepared and Approved; 7 returns Received, Noted and Checked (a filed IPAS is
 * reopened by a Super Admin instead).
 */
export const IPAS_SIGNOFF_ROLE = {
  PREPARED: "prepared",
  APPROVED: "approved",
  RECEIVED: "received",
  NOTED: "noted",
  CHECKED: "checked",
};

export const IPAS_SIGNOFF_ROLE_LABELS = {
  [IPAS_SIGNOFF_ROLE.PREPARED]: "Submitted",
  [IPAS_SIGNOFF_ROLE.APPROVED]: "Approved",
  [IPAS_SIGNOFF_ROLE.RECEIVED]: "Received",
  [IPAS_SIGNOFF_ROLE.NOTED]: "Noted",
  [IPAS_SIGNOFF_ROLE.CHECKED]: "Checked",
};

/** What the button says for each sign-off a person gives (section 7's Approved files the IPAS). */
export const IPAS_SIGNOFF_ROLE_ACTIONS = {
  [IPAS_SIGNOFF_ROLE.PREPARED]: "Submit",
  [IPAS_SIGNOFF_ROLE.APPROVED]: "Approve",
  [IPAS_SIGNOFF_ROLE.RECEIVED]: "Receive",
  [IPAS_SIGNOFF_ROLE.NOTED]: "Note",
  [IPAS_SIGNOFF_ROLE.CHECKED]: "Check",
};

export const IPAS_SIGNOFF_SECTIONS = [1, 3, 6, 7];
export const IPAS_SEND_BACK_SECTIONS = [1, 3, 6, 7];
/** The sections whose Approved can be undone, leaving Prepared. */
export const IPAS_UNDO_APPROVAL_SECTIONS = [1, 3, 6];
/** The stored section that is Filing (shown as 4) and the one that is Computation status & Landed Cost (shown as 3). */
export const IPAS_FILING_SECTION = 7;
export const IPAS_COSTING_SECTION = 6;
/** The stored section that is the Logistics sign-off (shown as 6): one Approved, which Filing waits for (#713). */
export const IPAS_LOGISTICS_SECTION = 8;
/** The stored section that is Purchasing's first sign-off (shown as 1): its Submit is what makes an IPAS Requested. */
export const IPAS_REQUEST_SECTION = 1;
/** The sections signed before Filing opens: every sign-off section but Filing. */
export const IPAS_PRE_FILING_SECTIONS = IPAS_SIGNOFF_SECTIONS.filter((section) => section !== IPAS_FILING_SECTION);
/** The reason the database gives when a changed PO in Odoo clears the approvals (history and the cleared rows carry it). */
export const IPAS_PO_CHANGED_REASON = "PO changed in Odoo";

/** Section 7's sign-offs in the order they are given (Noted and Checked in either order). */
export const IPAS_SECTION_7_ROLES = [
  IPAS_SIGNOFF_ROLE.RECEIVED,
  IPAS_SIGNOFF_ROLE.NOTED,
  IPAS_SIGNOFF_ROLE.CHECKED,
  IPAS_SIGNOFF_ROLE.APPROVED,
];

/** What `ipas_sign` says became ready (its `stage`), for the notification that follows. */
export const IPAS_SIGNOFF_STAGE = {
  SECTION_PREPARED: "section_prepared",
  RECEIVED_READY: "received_ready",
  NOTED_CHECKED_READY: "noted_checked_ready",
  APPROVE_READY: "approve_ready",
  FILED: "filed",
};

/**
 * The number each part of an IPAS shows, on screen and on the printed sheet, in
 * the order the module shows them (money and sign-offs first). The paper sheet
 * numbered them differently. Only what a person reads changes: the stored
 * sign-off sections stay 1, 3, 6 and 7 (`ipas_signoffs.section`, the signer lists,
 * the RPCs).
 */
export const IPAS_PART_NO = {
  purchasing: 1,
  finance: 2,
  costing: 3,
  filing: 4,
  sales: 5,
  logistics: 6,
  status: 7,
};

/** The name each part is shown by. */
export const IPAS_PART_NAMES = {
  purchasing: "Purchasing",
  finance: "Purchasing & Finance",
  costing: "Computation status & Landed Cost",
  filing: "Filing",
  sales: "Sales & Operation",
  logistics: "Logistics",
  status: "Status",
};

/** The part a stored sign-off section (1, 3, 6 or 7) is. */
export const IPAS_SECTION_PART = { 1: "purchasing", 3: "finance", 6: "costing", 7: "filing", 8: "logistics" };

/**
 * The number a stored sign-off section (1, 3, 6 or 7) shows as: 1, 2, 3, 4 (#552, #586).
 * The one mapping every screen, notice, history line and Settings list name
 * reads. Anything it doesn't know comes back as it was given.
 */
export function ipasSectionNo(section) {
  const no = IPAS_PART_NO[IPAS_SECTION_PART[section]];
  return no === undefined ? section : no;
}

/** "section 4": a stored sign-off section as it reads inside a sentence. */
export function ipasSectionWord(section) {
  return `section ${ipasSectionNo(section)}`;
}

/** "section 3": a part key ("costing") as it reads inside a sentence. */
export function ipasPartWord(part) {
  return `section ${IPAS_PART_NO[part]}`;
}

/** A stored sign-off section's name, unnumbered: "Purchasing", "Purchasing & Finance", "Filing". */
export function ipasSectionName(section) {
  return IPAS_PART_NAMES[IPAS_SECTION_PART[section]] ?? "";
}

/**
 * A section as a person reads it: "<no> · <name>", e.g. "2 · Purchasing & Finance".
 * Takes a part key ("finance") or a stored sign-off section (3). Anything it
 * doesn't know reads as it is given.
 */
export function ipasSectionLabel(partOrSection) {
  const part = IPAS_SECTION_PART[partOrSection] ?? partOrSection;
  const no = IPAS_PART_NO[part];
  if (no === undefined) return String(partOrSection);
  return `${no} · ${IPAS_PART_NAMES[part]}`;
}

/**
 * The signer lists (ipas_signer_lists.list_key): who may give each sign-off
 * after Prepared. Super Admins edit them; Submit needs Purchasing access.
 */
export const IPAS_SIGNER_LIST = {
  S1_APPROVED: "s1_approved",
  S3_APPROVED: "s3_approved",
  S6_APPROVED: "s6_approved",
  S7_RECEIVED: "s7_received",
  S7_NOTED: "s7_noted",
  S7_CHECKED: "s7_checked",
  S7_APPROVED: "s7_approved",
  LOGISTICS_SIGNED: "logistics_signed",
};

export const IPAS_SIGNER_LISTS = Object.values(IPAS_SIGNER_LIST);

/** The list that gives each section 7 sign-off. */
export const IPAS_SECTION_7_LIST = {
  [IPAS_SIGNOFF_ROLE.RECEIVED]: IPAS_SIGNER_LIST.S7_RECEIVED,
  [IPAS_SIGNOFF_ROLE.NOTED]: IPAS_SIGNER_LIST.S7_NOTED,
  [IPAS_SIGNOFF_ROLE.CHECKED]: IPAS_SIGNER_LIST.S7_CHECKED,
  [IPAS_SIGNOFF_ROLE.APPROVED]: IPAS_SIGNER_LIST.S7_APPROVED,
};

export const IPAS_SIGNER_LIST_LABELS = {
  [IPAS_SIGNER_LIST.S1_APPROVED]: `Section ${ipasSectionNo(1)} · Approved`,
  [IPAS_SIGNER_LIST.S3_APPROVED]: `Section ${ipasSectionNo(3)} · Approved`,
  [IPAS_SIGNER_LIST.S6_APPROVED]: `Section ${ipasSectionNo(6)} · Approved`,
  [IPAS_SIGNER_LIST.S7_RECEIVED]: `Section ${ipasSectionNo(7)} · Received`,
  [IPAS_SIGNER_LIST.S7_NOTED]: `Section ${ipasSectionNo(7)} · Noted`,
  [IPAS_SIGNER_LIST.S7_CHECKED]: `Section ${ipasSectionNo(7)} · Checked`,
  [IPAS_SIGNER_LIST.S7_APPROVED]: `Section ${ipasSectionNo(7)} · Approved (files the IPAS)`,
  [IPAS_SIGNER_LIST.LOGISTICS_SIGNED]: `Section ${ipasSectionNo(8)} · Logistics signed`,
};

/** The list that approves a section: the Approved of stored sections 1, 3 and 6. */
export const IPAS_APPROVAL_LIST = {
  1: IPAS_SIGNER_LIST.S1_APPROVED,
  3: IPAS_SIGNER_LIST.S3_APPROVED,
  6: IPAS_SIGNER_LIST.S6_APPROVED,
  7: IPAS_SIGNER_LIST.S7_APPROVED,
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
  odoo_copy_changed: "Odoo PO changed",
  odoo_changed_since_filing: "Odoo has changed since filing",
  approvals_cleared: "Approvals cleared",
  signed: "Signed off",
  sent_back: "Returned",
  approval_undone: "Approval undone",
  filed: "Filed",
  reopened: "Reopened",
  sor_warning_checked: "S0 warning checked",
  payment_added: "Payment added",
  payment_changed: "Payment changed",
  payment_removed: "Payment removed",
  charge_added: "Charge added",
  charge_changed: "Charge changed",
  charge_removed: "Charge removed",
  bank_details_set: "Bank details typed",
  bank_details_changed: "Bank details changed",
  account_flagged: "Account # flagged",
  documents_suggested: "Documents suggested",
  document_added: "Document added",
  document_ticked: "Document ticked",
  document_attachment_set: "Document attached",
  document_attachment_removed: "Attachment removed",
  document_removed: "Document removed",
  supplier_origin_changed: "Supplier Origin changed",
  status_typed: "Status typed",
  status_cleared: "Status cleared",
  actual_checking_stamped: "Actual Checking stamped",
  actual_checking_cleared: "Actual Checking cleared",
  item_location_changed: "Item Location changed",
  on_hold_set: "Put On-Hold",
  on_hold_changed: "On-Hold note changed",
  on_hold_cleared: "On-Hold cleared",
};
