/**
 * Sales Opportunity Registration (SOR) constants.
 * Source: Policy CCPR-2026-001 — Annex C (SORS) and Annex D (Lead Source Register).
 *
 * These are fixed by board policy: changing them is a policy amendment, which is
 * why they live in code and are mirrored by CHECK constraints on the table
 * (see supabase/migrations/0001_sales_opportunities.sql).
 */

// Annex D.2 — Approved Lead Sources
export const LEAD_SOURCES = [
  { value: "LGU", label: "LGU" },
  { value: "NGA", label: "NGA" },
  { value: "GOCC", label: "GOCC" },
  { value: "BFP", label: "BFP" },
  { value: "PNP", label: "PNP" },
  { value: "MIL", label: "MIL" },
  { value: "DRRM", label: "DRRM" },
  { value: "CORPORATE", label: "Corporate" },
  { value: "REFERRAL", label: "Referral" },
  { value: "WEBSITE", label: "Website" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "SHOPEE", label: "Shopee" },
  { value: "LAZADA", label: "Lazada" },
  { value: "EXHIBITION", label: "Exhibition" },
  { value: "REPEAT_CLIENT", label: "Repeat Client" },
];

// The sheet's "Sales Division" column. Drives the commission split in a later phase.
export const PROJECT_TYPES = [
  { value: "SSP", label: "SSP — Single Salesperson Project" },
  { value: "CP", label: "CP — Collaborative Project" },
  { value: "STRATEGIC", label: "Strategic Project" },
];

// Annex C.3 — pipeline, in order. CLOSED_LOST is reachable from any stage.
export const OPPORTUNITY_STATUS = {
  LEAD: "LEAD",
  QUALIFIED: "QUALIFIED",
  PROPOSAL_SUBMITTED: "PROPOSAL_SUBMITTED",
  BID_SUBMITTED: "BID_SUBMITTED",
  NEGOTIATION: "NEGOTIATION",
  AWARDED: "AWARDED",
  PO_RECEIVED: "PO_RECEIVED",
  PROJECT_DELIVERY: "PROJECT_DELIVERY",
  COLLECTION: "COLLECTION",
  CLOSED_WON: "CLOSED_WON",
  RETENTION: "RETENTION",
  CLOSED_LOST: "CLOSED_LOST",
};

export const OPPORTUNITY_STAGES = [
  { value: OPPORTUNITY_STATUS.LEAD, label: "Lead" },
  { value: OPPORTUNITY_STATUS.QUALIFIED, label: "Qualified" },
  { value: OPPORTUNITY_STATUS.PROPOSAL_SUBMITTED, label: "Proposal Submitted" },
  { value: OPPORTUNITY_STATUS.BID_SUBMITTED, label: "Bid Submitted" },
  { value: OPPORTUNITY_STATUS.NEGOTIATION, label: "Negotiation" },
  { value: OPPORTUNITY_STATUS.AWARDED, label: "Awarded" },
  { value: OPPORTUNITY_STATUS.PO_RECEIVED, label: "PO Received" },
  { value: OPPORTUNITY_STATUS.PROJECT_DELIVERY, label: "Project Delivery" },
  { value: OPPORTUNITY_STATUS.COLLECTION, label: "Collection" },
  { value: OPPORTUNITY_STATUS.CLOSED_WON, label: "Closed Won" },
  { value: OPPORTUNITY_STATUS.RETENTION, label: "Retention" },
  { value: OPPORTUNITY_STATUS.CLOSED_LOST, label: "Closed Lost" },
];

export const STAGE_LABELS = Object.fromEntries(
  OPPORTUNITY_STAGES.map((s) => [s.value, s.label]),
);

export const LEAD_SOURCE_LABELS = Object.fromEntries(
  LEAD_SOURCES.map((s) => [s.value, s.label]),
);

export const PROJECT_TYPE_LABELS = Object.fromEntries(
  PROJECT_TYPES.map((s) => [s.value, s.label]),
);

/** Short label for tables — the full PROJECT_TYPES label is too long inline. */
export const PROJECT_TYPE_SHORT = {
  SSP: "SSP",
  CP: "CP",
  STRATEGIC: "Strategic",
};

// ── Sales Reference (Odoo sales quotation no.) ──────────────────────────────
// The "S" number Odoo issues when the quotation is created, e.g. S01237. It is
// the evidence a quotation exists, which is what makes a lead qualified.
// Kept permissive on width to match the DB CHECK in migration 0011.

export const SALES_REFERENCE_PATTERN = /^S\d+$/;

export const SALES_REFERENCE_HINT =
  'Sales Reference must be the Odoo quotation number — "S" followed by digits, e.g. S01237.';

export const normalizeSalesReference = (value) =>
  (value || "").trim().toUpperCase();

export const isValidSalesReference = (value) =>
  SALES_REFERENCE_PATTERN.test(normalizeSalesReference(value));

/**
 * Whether a stage move requires a Sales Reference to already be on record.
 * Only moves *out of* Lead are gated: rows registered before this field
 * existed keep advancing, and a lead can still be lost before it is quoted.
 */
export const requiresSalesReference = (fromStatus, toStatus) =>
  fromStatus === OPPORTUNITY_STATUS.LEAD &&
  toStatus !== OPPORTUNITY_STATUS.LEAD &&
  toStatus !== OPPORTUNITY_STATUS.CLOSED_LOST;

/** Formats a PHP amount for display. */
export const formatPHP = (amount) =>
  `₱${Number(amount || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** "LGU - Bayambang" from the stored category + detail pair. */
export const formatLeadSource = (source, detail) => {
  const label = LEAD_SOURCE_LABELS[source] || source || "—";
  return detail ? `${label} - ${detail}` : label;
};
