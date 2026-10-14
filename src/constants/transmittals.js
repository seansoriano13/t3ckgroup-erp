/**
 * Transmittals (TG03, spec #251, issue #252): the vocabulary the screens and
 * the service share with the database (supabase/migrations/20261015100000).
 */

export const TRANSMITTAL_STATE = {
  DRAFT: "draft",
  WAREHOUSE_CHECKING: "warehouse_checking",
  WAREHOUSE_RELEASING: "warehouse_releasing",
  TECHNICAL_INSPECTION: "technical_inspection",
  AWAITING_CHECK: "awaiting_check",
  CLOSED: "closed",
  CANCELLED: "cancelled",
};

export const TRANSMITTAL_STATE_LABELS = {
  [TRANSMITTAL_STATE.DRAFT]: "Draft",
  [TRANSMITTAL_STATE.WAREHOUSE_CHECKING]: "Waiting on Warehouse",
  [TRANSMITTAL_STATE.WAREHOUSE_RELEASING]: "Waiting on release",
  [TRANSMITTAL_STATE.TECHNICAL_INSPECTION]: "Waiting on Technical",
  [TRANSMITTAL_STATE.AWAITING_CHECK]: "Awaiting Check by",
  [TRANSMITTAL_STATE.CLOSED]: "Closed",
  [TRANSMITTAL_STATE.CANCELLED]: "Cancelled",
};

/** The stage a slip is in once submitted; drafts and ended slips have none. */
export const TRANSMITTAL_STAGE = {
  WAREHOUSE_CHECKING: "warehouse_checking",
  WAREHOUSE_RELEASING: "warehouse_releasing",
  TECHNICAL_INSPECTION: "technical_inspection",
};

/** The staff list each stage's notification goes to (ipas_signer_lists keys). */
export const TRANSMITTAL_STAGE_LIST = {
  [TRANSMITTAL_STAGE.WAREHOUSE_CHECKING]: "transmittal_warehouse",
  [TRANSMITTAL_STAGE.WAREHOUSE_RELEASING]: "transmittal_warehouse",
  [TRANSMITTAL_STAGE.TECHNICAL_INSPECTION]: "transmittal_technical",
};

export const TRANSMITTAL_ORIGIN = {
  PURCHASING: "purchasing",
  LOGISTICS: "logistics",
  WAREHOUSE: "warehouse",
  OTHER: "other",
};

export const TRANSMITTAL_ORIGIN_LABELS = {
  [TRANSMITTAL_ORIGIN.PURCHASING]: "Purchasing",
  [TRANSMITTAL_ORIGIN.LOGISTICS]: "Logistics",
  [TRANSMITTAL_ORIGIN.WAREHOUSE]: "Warehouse",
  [TRANSMITTAL_ORIGIN.OTHER]: "Others",
};

export const TRANSMITTAL_PRIORITY = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

export const TRANSMITTAL_PRIORITIES = [TRANSMITTAL_PRIORITY.HIGH, TRANSMITTAL_PRIORITY.MEDIUM, TRANSMITTAL_PRIORITY.LOW];

export const TRANSMITTAL_PRIORITY_LABELS = {
  [TRANSMITTAL_PRIORITY.HIGH]: "High",
  [TRANSMITTAL_PRIORITY.MEDIUM]: "Medium",
  [TRANSMITTAL_PRIORITY.LOW]: "Low",
};

export const TRANSMITTAL_LINE_KIND = {
  PO_LINE: "po_line",
  TYPED: "typed",
};

/** The four Transmittal staff lists (ipas_signer_lists keys). */
export const TRANSMITTAL_STAFF_LIST = {
  WAREHOUSE: "transmittal_warehouse",
  TECHNICAL: "transmittal_technical",
  LOGISTICS: "transmittal_logistics",
  CHECK_BY: "transmittal_check_by",
};

export const TRANSMITTAL_STAFF_LISTS = Object.values(TRANSMITTAL_STAFF_LIST);

export const TRANSMITTAL_STAFF_LIST_LABELS = {
  [TRANSMITTAL_STAFF_LIST.WAREHOUSE]: "Transmittal · Warehouse",
  [TRANSMITTAL_STAFF_LIST.TECHNICAL]: "Transmittal · Technical",
  [TRANSMITTAL_STAFF_LIST.LOGISTICS]: "Transmittal · Logistics",
  [TRANSMITTAL_STAFF_LIST.CHECK_BY]: "Transmittal · Check by",
};

/** The option lists the business edits for a Transmittal. */
export const TRANSMITTAL_OPTION_LIST = {
  PRODUCT: "transmittal_product",
  REFERENCE: "transmittal_reference",
};

export const TRANSMITTAL_NOTIFICATION = {
  SUBMITTED: "TRANSMITTAL_SUBMITTED",
  CANCELLED: "TRANSMITTAL_CANCELLED",
};

/** Error codes the service raises (TransmittalError.code). */
export const TRANSMITTAL_ERROR = {
  INVALID: "TRANSMITTAL_INVALID",
};
