/**
 * Sales Opportunity Registration (SOR) constants.
 * Source: Policy CCPR-2026-001 — Annex C (SORS) and Annex D (Lead Source Register).
 *
 * These are fixed by board policy: changing them is a policy amendment, which is
 * why they live in code and are mirrored by CHECK constraints on the table
 * (see supabase/migrations/0001_sales_opportunities.sql).
 */

import { STATUS_THEME } from "./statusTheme";
import { isLostFlowStage, isPreWonFlowStage, isWonOrPostWonFlowStage } from "./salesFlow";

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
 * Whether an SOR is judged by its legacy stage code rather than a Flow
 * Snapshot graph: a legacy SOR (no Sale Type), or one on a flow with no
 * version on record at all. Legacy Pipeline SORs attached by the cutover
 * backfill are the second kind. An SOR that has a version, not yet loaded, is
 * still judged by its snapshot.
 */
export const isJudgedByStageCode = (opportunity) =>
  !opportunity?.sale_type_id || (!opportunity.flow_snapshot_id && !opportunity.flow_snapshot);

const flowSnapshotData = (opportunity, snapshotsById = {}) =>
  snapshotsById[opportunity.flow_snapshot_id]?.snapshot_data ?? opportunity.flow_snapshot?.snapshot_data;

/**
 * Whether an opportunity counts toward the Realized Commission Pool rather
 * than the Projected one.
 *
 * A fact about the deal, not a position in a list (ADR 0006). The Contract
 * Date is stamped the first time the deal reaches the Won Stage and only a
 * Revert of that move clears it (ADR 0026), so it answers "has this been
 * booked" without asking where the deal currently sits. For a flow-built deal
 * the check below decides by current Stage, not by the Contract Date.
 *
 * A lost deal never counts. A flow deal is Realized while on the Won Stage or
 * a non-terminal Stage downstream of it, and stops being Realized if it moves
 * back before it. A legacy deal is Realized at or past the anchor Stage, and
 * falls back to the Contract Date only when no anchor exists.
 */
export const isRealizedOpportunity = (opportunity, stagesOrContext = PIPELINE_STAGE_SEED) => {
  if (!opportunity) return false;

  const { snapshotsById = {}, stages = PIPELINE_STAGE_SEED } = Array.isArray(stagesOrContext)
    ? { stages: stagesOrContext }
    : stagesOrContext || {};

  // For a flow-built deal, evaluated dynamically against its Flow Snapshot graph:
  // sitting on the designated Won Stage or any non-terminal post-won Stage downstream.
  if (!isJudgedByStageCode(opportunity)) {
    const snapshotData = flowSnapshotData(opportunity, snapshotsById);
    if (!snapshotData) return false;
    const flowStage = (snapshotData.stages || []).find((s) => s.id === opportunity.flow_stage_id);
    if (!flowStage) return false;
    return isWonOrPostWonFlowStage(flowStage, snapshotData);
  }

  // Legacy SOR (no sale_type_id, or on a flow with no version on record, e.g.
  // Legacy Pipeline after the cutover backfill): sitting at or past the anchor (AWARDED) stage,
  // excluding terminal lost.
  const stage = stages.find((s) => s.code === opportunity.status);
  if (!stage || isLostCode(opportunity.status, stages)) return false;
  if (isWonCode(opportunity.status, stages)) return true;
  const anchor = anchorStage(stages);
  if (!anchor) return Boolean(opportunity.contract_date);
  return stage.sort_order >= anchor.sort_order;
};

/**
 * The SOR's current Stage, as far as "has it stopped moving" goes — or null
 * when it cannot be resolved. A flow SOR is resolved against its OWN Flow
 * Snapshot (issue #83): `snapshotsById[flow_snapshot_id]`, else an embedded
 * `flow_snapshot`. A legacy SOR is resolved by its pipeline stage code.
 */
const currentStageTerminality = (opportunity, { snapshotsById = {}, stages = PIPELINE_STAGE_SEED } = {}) => {
  if (!opportunity) return null;
  if (!isJudgedByStageCode(opportunity)) {
    const snapshotData = flowSnapshotData(opportunity, snapshotsById);
    const flowStage = (snapshotData?.stages || []).find((s) => s.id === opportunity.flow_stage_id);
    return flowStage ? { isTerminal: Boolean(flowStage.is_terminal) } : null;
  }
  const stage = stages.find((s) => s.code === opportunity.status);
  return stage ? { isTerminal: isTerminalStage(stage) } : null;
};

/**
 * Open Pipeline (CONTEXT.md):
 * For Flow SORs: any active deal currently sitting on a pre-won Stage
 * (a stage preceding the Won Stage in the flow graph).
 * For Legacy SORs: any active deal on a stage before the anchor (AWARDED) stage.
 * Excludes terminal stages; a lost SOR counts toward neither Open Pipeline nor Won.
 */
export const isOpenPipelineOpportunity = (opportunity, context = PIPELINE_STAGE_SEED) => {
  if (!opportunity) return false;

  const { snapshotsById = {}, stages = PIPELINE_STAGE_SEED } = Array.isArray(context)
    ? { stages: context }
    : context || {};

  if (!isJudgedByStageCode(opportunity)) {
    const snapshotData = flowSnapshotData(opportunity, snapshotsById);
    if (!snapshotData) return false;
    const flowStage = (snapshotData.stages || []).find((s) => s.id === opportunity.flow_stage_id);
    if (!flowStage) return false;
    return isPreWonFlowStage(flowStage, snapshotData);
  }

  // Legacy SOR (no sale_type_id, or on a flow with no version on record)
  const stage = stages.find((s) => s.code === opportunity.status);
  if (!stage || isTerminalStage(stage)) return false;
  const anchor = anchorStage(stages);
  if (!anchor) return true;
  return stage.sort_order < anchor.sort_order;
};

/**
 * Whether the SOR's current Stage is a Terminal Stage (won or lost) — issue
 * #206's default sort sinks these to the bottom of the register. An SOR whose
 * Stage can't be resolved sorts as not-terminal, the same under-reporting
 * direction the rest of this file takes.
 */
export const isOnTerminalStage = (opportunity, context) => {
  const stage = currentStageTerminality(opportunity, context);
  return Boolean(stage?.isTerminal);
};

/**
 * Still moving: the current Stage is not a Terminal Stage, won or not. Scopes
 * the Blocked filter and deadlines, so a won SOR on a post-award Stage (PO,
 * delivery, collection) still shows what those Stages owe.
 */
export const isStillMovingOpportunity = (opportunity, context) => {
  const stage = currentStageTerminality(opportunity, context);
  return Boolean(stage) && !stage.isTerminal;
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

export const normalizeSalesReference = (value) => {
  let val = (value || "").trim().toUpperCase();
  if (val.startsWith("SO") && /^\d+$/.test(val.slice(2))) {
    val = "S" + val.slice(2);
  }
  return val;
};

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
 * Whether an opportunity carries what the old ITB gate used to ask for — an
 * ITB Number on record, or the deal marked outright (no bidding involved).
 * The gate itself was removed (issue #206, ADR 0004 D12); this only decides
 * whether the details view has anything read-only to show.
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

/**
 * A toolbar-width PHP figure: ₱353.7M rather than ₱353,727,836.94.
 *
 * Only the seven-figure-and-up amounts are shortened, because those are the
 * only ones wide enough to crowd a toolbar — anything smaller keeps its
 * centavos, and OpportunitiesPage.test.jsx holds that line. Use this only for
 * a readout that is scanned rather than acted on, and only where the exact
 * amount is still one hover away (see SorsTotals).
 */
export const formatPHPCompact = (amount) => {
  const n = Number(amount || 0);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `₱${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `₱${(n / 1e6).toFixed(1)}M`;
  return formatPHP(n);
};

export const formatLeadSource = (source, detail, leadSources = []) => {
  const dynamicLabel = leadSources.find((s) => s.value === source)?.label;
  const label = dynamicLabel || source || "—";
  return detail ? `${label} - ${detail}` : label;
};

/** Filter value for SORs registered before Sale Types existed (`sale_type_id` null). */
export const NO_SALE_TYPE = "NONE";

/** Whether an SOR passes the register's Sale Type filter ("ALL", a Sale Type id, or NO_SALE_TYPE). */
export function matchesSaleType(opportunity, filter) {
  if (filter === "ALL" || !filter) return true;
  if (filter === NO_SALE_TYPE) return !opportunity.sale_type_id;
  return opportunity.sale_type_id === filter;
}
