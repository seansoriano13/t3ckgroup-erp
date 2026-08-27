/**
 * Sales Opportunity Registration (SOR) constants.
 * Source: Policy CCPR-2026-001 — Annex C (SORS) and Annex D (Lead Source Register).
 *
 * These are fixed by board policy: changing them is a policy amendment, which is
 * why they live in code and are mirrored by CHECK constraints on the table
 * (see supabase/migrations/0001_sales_opportunities.sql).
 */

import { STATUS_THEME } from "./statusTheme";
import { isLostFlowStage } from "./salesFlow";

// Lead Sources are now managed dynamically in the database (`crm_lead_sources` table).
// Previously, they were hardcoded here as LEAD_SOURCES.

// The sheet's "Sales Division" column. Drives the commission split in a later phase.
export const PROJECT_TYPES = [
  { value: "SSP", label: "SSP — Single Salesperson Project" },
  { value: "CP", label: "CP — Collaborative Project" },
  { value: "STRATEGIC", label: "Strategic Project" },
];

// ── Pipeline stages ─────────────────────────────────────────────────────────
// The default pipeline, in order. CLOSED_LOST is reachable from any stage.
// Twelve stages come from Annex C.3; For Bidding and Payment Verification were
// added on top of them.
//
// These rows are the *seed* for `crm_pipeline_stages` and the fallback
// the register renders when that table is empty or unreachable — they are no
// longer the source of truth at runtime. Nothing outside this file should ever
// match on a stage code again; ask the helpers below instead.
//
// The flags are what carry meaning, and none of them is a per-stage toggle an
// admin can invent:
//   is_default  the stage `sales_opportunities.status` defaults to, and the one
//               a Sales Reference is required to leave (migration 0011).
//   is_anchor   stamps Contract Date, which fixes the Commission Rate pricing
//               that opportunity forever. Exactly one, never editable.
//   is_won      terminal success.
//   is_lost     terminal failure; requires a lost reason, excluded from
//               commission, and reachable from any stage.
//   is_system   seeded by policy; cannot be deactivated or reordered.
//
// Realized-vs-Projected is deliberately NOT a flag here, and as of ADR 0006 it
// is not a property of a stage at all. It is a property of the deal: whether it
// has a Contract Date (see `isRealizedOpportunity`). No settings screen can move
// an opportunity between the two pools, because no stage carries the answer.
//
// sort_order is gapped by ten so inserting a stage never renumbers its
// neighbours, which would otherwise rewrite every row on an ordering change.
// For Bidding (35) and Payment Verification (65) were added into those gaps
// after the fact, which is the mechanism working as intended: no existing
// stage moved.
//
// Payment Verification sits AFTER the anchor. Under the retired positional
// rule that placement was itself a change to the Realized set, which is why
// adding a stage there was a migration and a policy decision. Under ADR 0006
// it is no longer load-bearing: a deal at Payment Verification counts as
// Realized because its Contract Date was stamped at Awarded, not because of
// where the stage sorts.

const stage = (code, label, sort_order, theme, flags = {}) => ({
  code,
  label,
  sort_order,
  theme,
  is_active: true,
  is_system: true,
  is_default: false,
  is_anchor: false,
  is_won: false,
  is_lost: false,
  is_itb_gate: false,
  ...flags,
});

export const PIPELINE_STAGE_SEED = [
  stage("LEAD", "Lead", 10, STATUS_THEME.MAUVE, { is_default: true }),
  stage("PROPOSAL_SUBMITTED", "Proposal Submitted", 20, STATUS_THEME.BLUE),
  stage("QUALIFIED", "Qualified", 30, STATUS_THEME.AMBER),
  stage("FOR_BIDDING", "For Bidding", 35, STATUS_THEME.AMBER, { is_itb_gate: true }),
  stage("BID_SUBMITTED", "Bid Submitted", 40, STATUS_THEME.BLUE),
  stage("NEGOTIATION", "Negotiation", 50, STATUS_THEME.VIOLET),
  stage("AWARDED", "Awarded", 60, STATUS_THEME.GREEN, { is_anchor: true }),
  stage("PAYMENT_VERIFICATION", "Payment Verification", 65, STATUS_THEME.AMBER),
  stage("PO_RECEIVED", "PO Received", 70, STATUS_THEME.GREEN),
  stage("PROJECT_DELIVERY", "Project Delivery", 80, STATUS_THEME.ORANGE),
  stage("COLLECTION", "Collection", 90, STATUS_THEME.ORANGE),
  stage("CLOSED_WON", "Closed Won", 100, STATUS_THEME.GREEN, { is_won: true }),
  stage("RETENTION", "Retention", 110, STATUS_THEME.VIOLET),
  stage("CLOSED_LOST", "Closed Lost", 120, STATUS_THEME.RED, { is_lost: true }),
];

/** The single stage that stamps Contract Date, or null if a list has none. */
export const anchorStage = (stages = PIPELINE_STAGE_SEED) =>
  stages.find((s) => s.is_anchor) ?? null;

/** The stage a newly registered opportunity starts in. */
export const defaultStage = (stages = PIPELINE_STAGE_SEED) =>
  stages.find((s) => s.is_default) ?? null;

/**
 * The single stage an ITB Number (Invitation to Bid) must be on record to
 * reach, or null if a list has none. Resolved by flag and compared by
 * position, the same way the Anchor Stage is — never by a literal sort_order
 * or code, which would silently detach from the gate the moment that stage is
 * renamed or reordered.
 */
export const itbGateStage = (stages = PIPELINE_STAGE_SEED) =>
  stages.find((s) => s.is_itb_gate) ?? null;

/**
 * Whether an opportunity counts toward the Realized Commission Pool rather
 * than the Projected one.
 *
 * A fact about the deal, not a position in a list (ADR 0006). The Contract
 * Date is stamped the first time the deal reaches the Stage that wins it and
 * is never un-stamped, so it answers "has this been booked" without asking
 * where the deal currently sits — which is the only thing that still works
 * once a Sales Flow is a graph and "at or past the anchor" has no meaning.
 *
 * Two consequences, both deliberate. A deal that has since moved backwards
 * stays Realized: its history already answered the question, and the
 * positional rule's special case for exactly this existed only because
 * position kept contradicting it. A lost deal never counts, whatever its
 * Contract Date says — the one guard the positional rule carried that is
 * about the deal rather than about the ordering.
 *
 * An opportunity with no Contract Date is not Realized. Under-reporting is
 * the safe direction to fail, because the alternative silently promotes
 * pipeline deals into booked money.
 */
export const isRealizedOpportunity = (opportunity, stages = PIPELINE_STAGE_SEED) => {
  if (!opportunity?.contract_date) return false;

  // Issue #36 — a flow-built deal carries a Sale Type and has no
  // crm_pipeline_stages code, so `status` is stale on it and `isLostCode`
  // cannot answer "is this lost". `isLostFlowStage` asks the same question
  // of the flow instead: a terminal Stage that is not the one the flow was
  // won at. Requires the caller to have embedded `flow_stage` — a missing
  // embed answers false rather than trusting an absence, the same
  // under-reporting direction a deal with no Contract Date fails in.
  if (opportunity.sale_type_id) {
    if (!opportunity.flow_stage) return false;
    return !isLostFlowStage(opportunity.flow_stage, opportunity.flow_stage.flow?.won_stage_id);
  }

  return !isLostCode(opportunity.status, stages);
};

/** Won or lost — an opportunity here has stopped moving. */
export const isTerminalStage = (s) => Boolean(s?.is_won || s?.is_lost);

/**
 * The pre-award region a super admin may add to, reorder, and deactivate
 * within. Everything from the anchor onward is the accounting pipeline that
 * Annex C and the commission engine depend on, so it stays locked — inserting
 * a stage there would change the Realized pool by side effect.
 */
export const isOpenRegionStage = (s, stages = PIPELINE_STAGE_SEED) => {
  const anchor = anchorStage(stages);
  if (!anchor || !s) return false;
  return s.sort_order < anchor.sort_order && !isTerminalStage(s);
};

/** Active stages in pipeline order — what a picker or board should render. */
export const activeStages = (stages = PIPELINE_STAGE_SEED) =>
  stages.filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order);

/**
 * Active stages, plus any deactivated stage an opportunity is still sitting
 * in. Deactivating a stage removes it from pickers — it must never also make
 * the opportunities inside it disappear from a board or matrix.
 *
 * `occupiedCodes` is whatever the caller's own opportunities carry in
 * `status`; duplicates are fine.
 */
export const renderableStages = (stages = PIPELINE_STAGE_SEED, occupiedCodes = []) => {
  const occupied = new Set(occupiedCodes);
  return stages
    .filter((s) => s.is_active || occupied.has(s.code))
    .sort((a, b) => a.sort_order - b.sort_order);
};

// ── Asking about the code stored on an opportunity ──────────────────────────
// `sales_opportunities.status` holds a stage code, so most callers have a
// string rather than a row. These resolve it for them. A code that is no
// longer in the list — a row written before a stage was retired — resolves to
// null and answers false to everything, rather than throwing inside a render.

export const stageByCode = (code, stages = PIPELINE_STAGE_SEED) =>
  stages.find((s) => s.code === code) ?? null;

export const isWonCode = (code, stages = PIPELINE_STAGE_SEED) =>
  Boolean(stageByCode(code, stages)?.is_won);

export const isLostCode = (code, stages = PIPELINE_STAGE_SEED) =>
  Boolean(stageByCode(code, stages)?.is_lost);

export const isAnchorCode = (code, stages = PIPELINE_STAGE_SEED) =>
  Boolean(stageByCode(code, stages)?.is_anchor);

export const isTerminalCode = (code, stages = PIPELINE_STAGE_SEED) =>
  isTerminalStage(stageByCode(code, stages));

// ── Compatibility views over the seed ───────────────────────────────────────
// Existing call sites still read these shapes. They derive from the seed so the
// two can never drift; consumers move onto the loaded stage list ticket by
// ticket, and these disappear once the last one has.

export const OPPORTUNITY_STATUS = Object.fromEntries(
  PIPELINE_STAGE_SEED.map((s) => [s.code, s.code]),
);

export const OPPORTUNITY_STAGES = PIPELINE_STAGE_SEED.map((s) => ({
  value: s.code,
  label: s.label,
}));

export const STAGE_LABELS = Object.fromEntries(
  PIPELINE_STAGE_SEED.map((s) => [s.code, s.label]),
);

// Dynamic lead sources replaced LEAD_SOURCE_LABELS.

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
 * Only moves *out of* the entry stage are gated: rows registered before this
 * field existed keep advancing, and a lead can still be lost before it is
 * quoted.
 *
 * Reads the is_default and is_lost flags rather than matching 'LEAD' and
 * 'CLOSED_LOST', so renaming either stage cannot quietly disable the gate.
 * Mirrored by a trigger — see migration 0011.
 */
export const requiresSalesReference = (
  fromStatus,
  toStatus,
  stages = PIPELINE_STAGE_SEED,
) =>
  Boolean(stageByCode(fromStatus, stages)?.is_default) &&
  toStatus !== fromStatus &&
  !isLostCode(toStatus, stages);

/**
 * Whether a stage move requires an ITB Number (Invitation to Bid) to be on
 * record. Required when moving from before the gate stage (For Bidding) to it
 * or beyond; rows already at or past it keep advancing without a second ask.
 *
 * Compared against the gate stage's own sort_order, not a literal — reordering
 * or renaming For Bidding must move the gate with it. A stage list with no
 * gate stage requires nothing, the same fail-safe direction
 * isRealizedOpportunity takes for a deal with no Contract Date.
 *
 * This answers only "does the gate stand in the way of this move" — never
 * "has this opportunity already satisfied it". Ask itbGateSatisfiedBy() for
 * that; the two are separate because the gate is crossed by a move and
 * satisfied by a record, and conflating them is how the exemption gets
 * forgotten at one call site out of three.
 */
export const requiresItbNumber = (
  fromStatus,
  toStatus,
  stages = PIPELINE_STAGE_SEED,
) => {
  const gate = itbGateStage(stages);
  const fromStage = stageByCode(fromStatus, stages);
  const toStage = stageByCode(toStatus, stages);
  if (!gate || !fromStage || !toStage) return false;

  return (
    fromStage.sort_order < gate.sort_order &&
    toStage.sort_order >= gate.sort_order &&
    !isLostCode(toStatus, stages)
  );
};

/**
 * Whether an opportunity already has what the ITB gate asks for.
 *
 * Two things satisfy it, and the second is the whole reason the gate is
 * survivable: an ITB Number on record, or the deal being marked outright —
 * an award with no bidding involved, government direct contracts among them,
 * where no Invitation to Bid was ever issued and so no number exists to give.
 * Without that second answer the gate could only block those deals or be
 * switched off for everybody, which is exactly what happened between
 * migrations 0035 and 0038.
 *
 * Every gate check goes through here rather than spelling out the pair
 * inline, so a caller cannot honour the number and forget the exemption.
 * Mirrored by the trigger — see migration 0038.
 */
export const itbGateSatisfiedBy = (opportunity) =>
  Boolean(opportunity?.itb_number || opportunity?.itb_exempt);

/** What the register shows in place of an ITB Number for an outright deal. */
export const ITB_EXEMPT_LABEL = "Outright — no bidding required";

/** Formats a PHP amount for display. */
export const formatPHP = (amount) =>
  `₱${Number(amount || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const formatLeadSource = (source, detail, leadSources = []) => {
  const dynamicLabel = leadSources.find((s) => s.value === source)?.label;
  const label = dynamicLabel || source || "—";
  return detail ? `${label} - ${detail}` : label;
};
