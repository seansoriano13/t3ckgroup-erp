import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";
import { purchasingService } from "./purchasingService";
import { notificationService } from "./notificationService";
import { sorStageParticipantService } from "./sorStageParticipantService";
import { pipelineStageService } from "./pipelineStageService";
import { getCurrentLocalDate } from "../utils/formatDate";
import { deriveProjectType } from "../utils/commission";
import {
  STAGE_LABELS,
  formatPHP,
  isAnchorCode,
  isLostCode,
  isValidSalesReference,
  normalizeSalesReference,
  requiresSalesReference,
  SALES_REFERENCE_HINT,
} from "../constants/sor";
import {
  deadlineStatus,
  evaluateCrossing,
  evaluateCondition,
  CONDITION_KINDS,
  CONDITION_STATUS,
  stagesCrossed,
  blockingConditions,
  missingStageFields,
} from "../constants/stageGate";
import { normaliseTeam, resolvePeople, DEAL_TEAM_ROLES } from "../utils/resolvePeople";
import { employeeGroupService } from "./employeeGroupService";
import {
  entryStage,
  isLegalMove,
  conditionsForSnapshotStage,
  actionsForSnapshotStage,
  stageActionTaskTitle,
  snapshotRows,
} from "../constants/salesFlow";
import { formatSnapshotVersion } from "../constants/flowVersion";
import { renderTemplate } from "../constants/taskTemplates";
import { nextFollowUpDue } from "../constants/followUp";
import { visitOwnsTask } from "../constants/journey";

/**
 * Decides what `odoo_partner_id` should be after an update.
 *
 * The marker says "this Company came from that Odoo customer", so it may only
 * survive while the Company text still does. The form modal owns the marker
 * and sends it explicitly; every other editor (the details modal's inline
 * edit, for one) sends a Company without one, and for those the rule is
 * enforced here rather than trusted to each caller — a marker that outlives
 * the name it verified makes a hand-typed Company look checked.
 */
function resolveOdooPartner(existing, payload) {
  if ("odoo_partner_id" in payload) return payload.odoo_partner_id ?? null;
  return payload.client_name === existing.client_name
    ? (existing.odoo_partner_id ?? null)
    : null;
}

const PARTICIPANT_SELECT = `
  *,
  registrar:employees!sales_opportunities_registered_by_fkey(id, name, avatar_path),
  deal_owner:employees!sales_opportunities_deal_owner_id_fkey(id, name, avatar_path, department, sub_department, is_super_admin),
  closing_sales:employees!sales_opportunities_closing_sales_id_fkey(id, name, avatar_path),
  support_1:employees!sales_opportunities_support_sales_1_id_fkey(id, name, avatar_path),
  support_2:employees!sales_opportunities_support_sales_2_id_fkey(id, name, avatar_path),
  sales_director:employees!sales_opportunities_sales_director_id_fkey(id, name, avatar_path)
`;

/**
 * The SOR's real, directly writable fields and how each is written. This is
 * the one list of "which keys are columns": `updateOpportunity` writes only
 * the keys here that a payload carries, and `saveRecordField` routes anything
 * not here into metadata. Derived fields (Project Type, the Odoo partner,
 * Estimated Value) are not listed — they follow their inputs.
 */
const RECORD_FIELD_WRITERS = {
  lead_source: (v) => v,
  lead_source_detail: (v) => v || null,
  client_name: (v) => v,
  contact_person: (v) => v || null,
  project_title: (v) => v,
  sales_reference: (v) => cleanSalesReference(v),
  expected_award_date: (v) => v || null,
  po_date: (v) => v || null,
  deal_owner_id: (v) => v || null,
  closing_sales_id: (v) => v || null,
  support_sales_1_id: (v) => v || null,
  support_sales_2_id: (v) => v || null,
  sales_director_id: (v) => v || null,
};

/** Real SOR fields the Stage Checklist offers no Save input for: people, and the ITB exemption flag. */
const CHECKLIST_UNWRITABLE_FIELDS = new Set([
  "deal_owner_id",
  "closing_sales_id",
  "support_sales_1_id",
  "support_sales_2_id",
  "sales_director_id",
]);

/**
 * Trims/uppercases a Sales Reference and rejects anything that isn't an Odoo
 * quotation number. Empty is allowed here — the stage gate is what makes it
 * mandatory, not the field itself.
 */
function cleanSalesReference(value) {
  const ref = normalizeSalesReference(value);
  if (!ref) return null;
  if (!isValidSalesReference(ref)) throw new Error(SALES_REFERENCE_HINT);
  return ref;
}

/**
 * Strips a leading "[SKU-CODE] " prefix so change logs read as plain product
 * names instead of raw catalog codes.
 */
function stripProductCode(name) {
  return (name || "").replace(/^\[[^\]]*\]\s*/, "");
}

/** The narration a condition's satisfaction writes, however it got satisfied. */
async function noteConditionSatisfied(opportunityId, condition, actorId) {
  await opportunityService.addSystemNote(
    opportunityId,
    `Condition satisfied: "${condition.label}".`,
    { event: "STAGE_CONDITION_SATISFIED", conditionId: condition.id, label: condition.label, employeeId: actorId },
    actorId,
  );
}

/**
 * The Employee Groups a member's id belongs to, keyed by employee id — built
 * once per gate read from `employeeGroupService.list()` (issue #201's own
 * authority for "who's in a group") so `membersForGate` stays a pure
 * function instead of each call site re-deriving membership.
 */
function groupIdsByEmployee(groups = []) {
  const byEmployee = new Map();
  for (const group of groups) {
    for (const employeeId of group.memberIds || []) {
      const key = String(employeeId);
      if (!byEmployee.has(key)) byEmployee.set(key, []);
      byEmployee.get(key).push(group.id);
    }
  }
  return byEmployee;
}

/**
 * Turns `sales_opportunity_members` rows into the `{ employeeId, department,
 * teamId, groupIds, assignedAt }` shape `evaluateCondition`'s `assignment`
 * kind expects (constants/stageGate.js). An `assignment` condition's config
 * names one department string (e.g. "Purchasing" or "OPERATIONS") without
 * saying which level of `employees.department`/`sub_department` it means, so
 * each member contributes one entry per level they actually have — a lookup
 * against either matches. `groupsByEmployee` (from `groupIdsByEmployee`) and
 * `teamId` (the member's normalised Sub-department, issue #201's Team unit)
 * are attached so a `who` selector of kind "group" or "team" can resolve
 * against a real SOR, not just "employee" and legacy department-string
 * selectors.
 */
function membersForGate(rows = [], groupsByEmployee = new Map()) {
  const entries = [];
  for (const row of rows) {
    const department = row.employee?.department;
    const subDepartment = row.employee?.sub_department;
    const teamId = normaliseTeam(subDepartment) || null;
    const groupIds = groupsByEmployee.get(String(row.employee_id)) || [];
    if (department) {
      entries.push({ employeeId: row.employee_id, department, teamId, groupIds, assignedAt: row.added_at });
    }
    if (subDepartment) {
      entries.push({
        employeeId: row.employee_id,
        department: subDepartment,
        teamId,
        groupIds,
        assignedAt: row.added_at,
      });
    }
  }
  return entries;
}

/**
 * Stage Gate Engine, ticket 5 (.scratch/stage-gate-engine/issues/05-per-kind-
 * satisfaction.md) — narrates a Stage's live-evaluated conditions
 * (attachment/field/assignment) that flip from unsatisfied to satisfied as a
 * result of one action, the way a stage move already narrates itself.
 * `tickbox` isn't included: it has no "before/after" to diff, since ticking
 * it IS the satisfying action (see satisfyCondition, below).
 *
 * Scoped to `stageCode`'s own conditions — the deal's current Stage, the
 * one whose gate is actually still open. A Stage already left had every
 * required item satisfied already (or the move would have been refused), so
 * there is nothing there left to newly satisfy.
 */
async function narrateNewlySatisfied(opportunityId, stageId, flowSnapshotId, before, after, actorId) {
  if (!stageId) return;

  // Flow Stages use UUIDs. If it's a legacy string like "LEAD", conditions don't apply.
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stageId);
  if (!isUUID) return;

  const kinds = [CONDITION_KINDS.ATTACHMENT, CONDITION_KINDS.FIELD, CONDITION_KINDS.ASSIGNMENT];
  let conditions;
  if (flowSnapshotId) {
    // Issue #83 — a flow-built deal's conditions are resolved from its own
    // Flow Snapshot, not the live table: a condition added or removed on
    // the live flow after this SOR registered must not change what it
    // narrates as newly satisfied.
    const { data: snapshot, error } = await supabase
      .from("flow_snapshots")
      .select("snapshot_data")
      .eq("id", flowSnapshotId)
      .single();
    if (error) throw error;
    conditions = conditionsForSnapshotStage(snapshot.snapshot_data?.conditions || [], stageId).filter((c) =>
      kinds.includes(c.kind),
    );
  } else {
    // 5. Stage Conditions Configuration (Flow Stages only)
    // Which Stage Gate Conditions are currently configured for this deal's flow stage?
    const { data, error } = await supabase
      .from("stage_conditions")
      .select("*")
      .eq("stage_id", stageId)
      .is("archived_at", null)
      .in("kind", kinds);
    if (error) throw error;
    conditions = data;
  }
  if (!conditions || conditions.length === 0) return;

  for (const condition of conditions) {
    const wasSatisfied =
      evaluateCondition(condition, before).status === CONDITION_STATUS.SATISFIED;
    const isSatisfied =
      evaluateCondition(condition, after).status === CONDITION_STATUS.SATISFIED;

    if (!wasSatisfied && isSatisfied) {
      await noteConditionSatisfied(opportunityId, condition, actorId);
    }
  }
}

/**
 * A `sales_opportunity_logs` row's `metadata.attachments`, shaped into the
 * `{ ...file, uploadedBy, uploadedAt }` evidence `evaluateCondition`'s
 * `attachment` kind expects (constants/stageGate.js) — a note's attachments
 * are the only place a file lives today (addNote, below), read live rather
 * than re-stored. Its own function because both `gateContext` (one
 * opportunity) and `getBlockedDeals` (many, batched) need the same per-log
 * shape, just grouped differently afterward.
 */
function attachmentsFromLog(log) {
  return (log.metadata?.attachments || []).map((a) => ({
    ...a,
    uploadedBy: log.author_id,
    uploadedAt: log.created_at,
  }));
}

/** Buckets `rows` by the value of `key` — the one grouping shape every batch read below needs, just on different columns. */
function groupBy(rows, key) {
  const groups = {};
  for (const row of rows || []) {
    (groups[row[key]] ??= []).push(row);
  }
  return groups;
}

/**
 * Live (non-archived) `stage_conditions` for a set of Stage codes, grouped
 * by Stage — the read every batch caller below starts from, before asking
 * "what does THIS deal's own Stage carry". `narrow` lets a caller add its
 * own filter (e.g. `getBlockedDeals`' is_required/kind) on top of the
 * archived_at check every caller needs regardless.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function conditionsByStageFor(stageIds, narrow = (query) => query) {
  // `stage_conditions.stage_id` is a uuid FK into `flow_stages`. A legacy
  // pipeline deal is identified by a code ("LEAD"), which is not a Stage id
  // and can never match a row here — but passing one through made Postgres
  // reject the whole IN-list with 22P02 rather than return nothing, taking
  // out every caller that happened to batch a legacy deal alongside a flow
  // one. Callers should already be passing Stage ids only (see
  // `deadlineEvaluations`); this is the backstop that keeps a stray code from
  // failing the read for everyone else.
  const ids = [...new Set((stageIds || []).filter((id) => UUID_RE.test(String(id))))];
  if (ids.length === 0) return { conditions: [], conditionsByStage: {} };

  const { data: conditions, error } = await narrow(
    supabase.from("stage_conditions").select("*").in("stage_id", ids).is("archived_at", null),
  );
  if (error) throw error;
  return { conditions: conditions || [], conditionsByStage: groupBy(conditions, "stage_id") };
}

/**
 * The SOR's currently-open Stage Visit (issue #203) — null for a legacy
 * pipeline deal (no `flow_stage_id`, so the trigger never opens one for it)
 * or for a flow deal caught between the move that closed one visit and the
 * insert that opens the next (never true within a single request, since the
 * trigger runs inside the same UPDATE). Callers use this to scope
 * visit-owned evidence (`sor_condition_status`, condition attachments,
 * `sor_stage_field_values`) so a loop back re-asks instead of reusing a
 * closed visit's evidence (story 28).
 */
// What the SOR modal reads for an SOR's tasks — the Now tab's rows and each
// Journey visit's list — in one place, so the two can't drift apart on which
// columns decide a row's due date, parts done, owner, or Stage Visit.
const SOR_TASK_COLUMNS =
  "id, project_title, task_description, status, created_at, end_at, stage_visit_id, logged_by, assignee:employees!tasks_logged_by_fk(id, name, avatar_path)";
const SOR_GROUP_TASK_COLUMNS = `
  id, title, description, status, created_at, due_date, stage_visit_id,
  creator:employees!committee_tasks_created_by_fkey(id, name, avatar_path),
  members:committee_task_members(
    id, role, custom_role, task_description, status,
    employee:employees!committee_task_members_employee_id_fkey(id, name, avatar_path)
  )
`;

async function currentVisitFor(opportunityId) {
  const { data, error } = await supabase
    .from("sor_stage_visits")
    .select("*")
    .eq("opportunity_id", opportunityId)
    .is("left_at", null)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Everything `evaluateCondition`/`evaluateCrossing` need to judge the
 * conditions configured on `stageCodes`, for one opportunity: the
 * conditions themselves (grouped by Stage), the attachment evidence, the
 * SOR Members, and any `sor_condition_status` rows. Shared by the live
 * gate check (ticket 2) and the read-only checklist (ticket 6) so both agree
 * on what "satisfied" means from a single place, rather than each doing its
 * own fetch-and-shape.
 */
/**
 * The per-deal evidence `evaluateCondition`/`evaluateCrossing` judge a fixed
 * list of `conditions` against: attachments, SOR Members, and any
 * `sor_condition_status` rows. Split out from `gateContext` (issue #83) so a
 * flow-built deal's gate can supply conditions read from its own Flow
 * Snapshot instead of the live `stage_conditions` table, while still sharing
 * this one evidence read with the legacy pipeline's gate and the read-only
 * checklist.
 */
async function gateEvidenceFor(opportunityId, conditions, { stageVisitId, asOf } = {}) {
  if (conditions.length === 0) {
    return { attachments: [], members: [], statusRowsByCondition: {} };
  }

  const conditionIds = conditions.map((r) => r.id);
  let statusQuery = supabase
    .from("sor_condition_status")
    .select("*")
    .eq("opportunity_id", opportunityId)
    .in("condition_id", conditionIds);
  // Issue #203, story 28: a tickbox certified on a visit that has since
  // closed must ask again. Scoped only when a visit is known — a legacy
  // pipeline deal (no flow Stage, so no visit ever opens for it) keeps the
  // pre-#203 opportunity-wide read.
  if (stageVisitId) statusQuery = statusQuery.eq("stage_visit_id", stageVisitId);

  const [{ data: statusRows, error: statusError }, { data: logs, error: logsError }, memberRows, groups] =
    await Promise.all([
      statusQuery,
      supabase
        .from("sales_opportunity_logs")
        .select("author_id, created_at, metadata")
        .eq("opportunity_id", opportunityId),
      opportunityService.getMembers(opportunityId),
      employeeGroupService.list(),
    ]);
  if (statusError) throw statusError;
  if (logsError) throw logsError;

  let attachments = (logs || []).flatMap(attachmentsFromLog);
  // Same visit-scoping for attachment evidence (story 12-15/28): a file
  // stamped to a previous visit doesn't count toward this one. An
  // attachment with no `stageVisitId` at all predates the stamping this
  // issue adds, or a visit is unknown — it keeps counting either way.
  if (stageVisitId) {
    attachments = attachments.filter((a) => !a.stageVisitId || a.stageVisitId === stageVisitId);
  }

  const statusRowsByCondition = {};
  for (const row of statusRows || []) {
    statusRowsByCondition[row.condition_id] = row;
  }

  // A closed visit is judged on the Deal Team it had when it closed (#300):
  // SOR Members are additive and permanent, so filtering on `added_at` is
  // that team exactly, and someone added since can't make a finished visit
  // read as having met a condition it never met.
  const membersThen = asOf ? memberRows.filter((m) => !m.added_at || m.added_at <= asOf) : memberRows;

  return { attachments, members: membersForGate(membersThen, groupIdsByEmployee(groups)), statusRowsByCondition };
}

async function gateContext(opportunityId, stageIds) {
  const { conditions, conditionsByStage } = await conditionsByStageFor(stageIds);
  const visit = await currentVisitFor(opportunityId);
  const evidence = await gateEvidenceFor(opportunityId, conditions, { stageVisitId: visit?.id });
  return { conditionsByStage, ...evidence };
}

async function hasInclusionsFor(opportunityId, { asOf } = {}) {
  let query = supabase.from("sor_inclusions").select("id").eq("opportunity_id", opportunityId);
  if (asOf) query = query.lte("created_at", asOf);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function hasPurchasingFor(opportunityId, { asOf } = {}) {
  let query = supabase.from("sor_procurement_requests").select("id").eq("opportunity_id", opportunityId);
  if (asOf) query = query.lte("created_at", asOf);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * `asOf` (a closed visit's `left_at`) counts only rows that existed by then.
 * It sees a row added since, not one deleted since — Inclusions and
 * Procurement Requests keep no deletion record to read that back from.
 */
async function resolveHasInclusions(conditions, opportunityId, { asOf } = {}) {
  const needsIt = conditions.some((r) => r.kind === CONDITION_KINDS.INCLUSIONS);
  return needsIt ? hasInclusionsFor(opportunityId, { asOf }) : false;
}

async function resolveHasPurchasing(conditions, opportunityId, { asOf } = {}) {
  const needsIt = conditions.some((r) => r.kind === CONDITION_KINDS.PURCHASING);
  return needsIt ? hasPurchasingFor(opportunityId, { asOf }) : false;
}

/**
 * Stage Gate Engine (docs/stage-gate-engine-spec.md, ticket 2 of
 * .scratch/stage-gate-engine/issues/) — throws if any required condition
 * on any Stage the move crosses is unsatisfied, naming what's missing.
 * Coexists with the ITB gate in `updateStatus`; either can block the same
 * move, independently, on unrelated things.
 *
 * Evaluates every Stage in `[from, to)`, not just the destination, so a
 * multi-Stage jump can't skip past a condition it never satisfied.
 * `opportunityAfterMove` should be `{ ...existing, ...patch }` — the same
 * "as it will be after this move" rule the ITB check applies to itself — so
 * a `field` condition on a column this same call is about to set (e.g.
 * Sales Reference) sees the incoming value, not the one it's replacing.
 */
async function assertStageGateSatisfied(opportunityId, fromCode, toCode, opportunityAfterMove) {
  const stages = await pipelineStageService.getAllStages();
  const crossed = stagesCrossed(fromCode, toCode, stages);
  if (crossed.length === 0) return;

  const { conditionsByStage, attachments, members, statusRowsByCondition } = await gateContext(
    opportunityId,
    crossed.map((s) => s.code),
  );
  if (Object.keys(conditionsByStage).length === 0) return;

  const conditions = Object.values(conditionsByStage).flat();
  const hasInclusions = await resolveHasInclusions(conditions, opportunityId);
  const hasPurchasing = await resolveHasPurchasing(conditions, opportunityId);

  const gateResult = evaluateCrossing({
    fromCode,
    toCode,
    stages,
    conditionsByStage,
    opportunity: opportunityAfterMove,
    attachments,
    members,
    statusRowsByCondition,
    hasInclusions,
    hasPurchasing,
  });

  if (!gateResult.blocked) return;

  const missing = gateResult.missing
    .map(({ stage, condition }) => `${condition.label} (${STAGE_LABELS[stage.code] || stage.label})`)
    .join(", ");
  throw new Error(`Cannot move to ${STAGE_LABELS[toCode] || toCode} — missing: ${missing}.`);
}

// ── Deals that run a Sales Flow (issue #36, ADR 0006) ───────────────────────
// A deal carrying a `sale_type_id` moves through the graph the Operations
// Manager drew rather than through the global ordered pipeline. Everything
// below serves the one branch inside `updateStatus`; there is deliberately no
// second public way to move an SOR, because two transition paths is exactly
// the defect reusing the funnel prevents.

/**
 * The Sale Type's own flow's most recently locked Flow Snapshot (issue #83)
 * — what an SOR's rules are resolved from for its whole life, from
 * registration on. Named error, not a silent fallback to the live flow:
 * registering against an unlocked flow is exactly the defect this issue
 * exists to close off.
 */
async function latestSnapshotFor(saleTypeId) {
  const { data: flow, error: flowError } = await supabase
    .from("sales_flows")
    .select("id")
    .eq("sale_type_id", saleTypeId)
    .single();
  if (flowError) throw flowError;

  const { data: snapshot, error: snapshotError } = await supabase
    .from("flow_snapshots")
    .select("*")
    .eq("flow_id", flow.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snapshotError) throw snapshotError;
  if (!snapshot) {
    throw new Error(
      "That Sale Type's flow has not been locked yet, so a deal cannot be registered against it.",
    );
  }
  return snapshot;
}

/**
 * The Flow Snapshot an existing SOR already runs — the source of truth for
 * every read that decides its behaviour from here on (issue #83): permitted
 * moves, Stage Conditions, Stage Actions, Won Stage. Not the live flow.
 *
 * A flow-built deal with no snapshot on record is not a valid state (a
 * legacy deal from before this migration whose flow was never locked), so
 * this refuses rather than falling back to live tables the way registration
 * used to.
 */
async function snapshotContextFor(opportunity) {
  if (!opportunity.flow_snapshot_id) {
    throw new Error(
      "This deal has no Flow Snapshot on record, so it cannot be moved. A Super Admin needs to assign one first.",
    );
  }

  const { data: snapshot, error } = await supabase
    .from("flow_snapshots")
    .select("*")
    .eq("id", opportunity.flow_snapshot_id)
    .single();
  if (error) throw error;

  const d = snapshot.snapshot_data || {};
  return {
    snapshot,
    stages: d.stages || [],
    edges: d.edges || [],
    actions: d.actions || [],
    conditions: d.conditions || [],
    stageFields: d.stageFields || [],
    wonStageId: d.wonStageId ?? null,
  };
}

/** Where a deal entering `saleTypeId`'s flow lands, and the snapshot it lands there under. Throws if the flow has no Stages to land on. */
async function entryStageFor(saleTypeId) {
  const snapshot = await latestSnapshotFor(saleTypeId);
  const entry = entryStage(snapshot.snapshot_data?.stages || []);
  if (!entry) {
    throw new Error("That Sale Type's flow has no Stages yet, so a deal cannot be placed on it.");
  }
  return { snapshot, entry };
}

/**
 * Whether this deal has ever changed Stage, from its own timeline.
 *
 * Not the same question as "is it on its flow's first Stage": a flow may loop
 * back to its own entry, so a deal can be sitting there having already been
 * round once. Changing a Sale Type is permitted only before the first move
 * (issue #36), and it is the history that answers that, not the position.
 */
async function hasEverMoved(opportunityId) {
  const { data, error } = await supabase
    .from("sales_opportunity_logs")
    .select("metadata")
    .eq("opportunity_id", opportunityId);
  if (error) throw error;

  return (data || []).some((log) => log.metadata?.event === "STAGE_CHANGED");
}

/**
 * The whole of a flow-built deal's stage move — the branch `updateStatus`
 * takes when the deal carries a Sale Type.
 *
 * A move traverses EXACTLY ONE EDGE (ADR 0006). There is no canonical path
 * between two arbitrary Stages in a graph, so the crossed-Stages interval the
 * global pipeline uses has no meaning here, and the only Stage evaluated is
 * the one being left. That is simpler than the interval rather than a
 * replacement for it.
 *
 *
 * The legacy gates — Sales Reference and ITB — are not
 * applied to flow-built deals. `stage_conditions` DO apply to flow-built
 * deals, because they are keyed to `flow_stages(id)`.
 */
async function moveAlongFlow(existing, nextStageId, actorId) {
  // Issue #83 — every rule this move is judged by (which Stages exist, which
  // edges are legal, what conditions gate the stage being left, where the
  // deal is won) is resolved from the SOR's OWN Flow Snapshot, not the live
  // flow. Editing the live flow after this deal registered must not change
  // what it is held to mid-run.
  const {
    stages,
    edges,
    wonStageId,
    conditions: snapshotConditions,
    actions: snapshotActions,
    stageFields: snapshotStageFields,
  } = await snapshotContextFor(existing);

  const from = stages.find((s) => s.id === existing.flow_stage_id) || null;
  const to = stages.find((s) => s.id === nextStageId) || null;
  if (!to) {
    throw new Error("That is not a Stage in this deal's flow.");
  }
  if (from?.id === to.id) return existing;

  if (from?.is_terminal) {
    throw new Error("A terminal stage cannot be left.");
  }

  // ADR 0006: a move traverses exactly one edge. There is no canonical path
  // between two Stages in a graph, so "is Qualified reachable from Lead" is
  // meaningless — only "did somebody draw that edge" is. Checked ahead of the
  // condition gate: an illegal move should refuse for being illegal, not
  // report itself as blocked by whatever conditions the destination
  // happens to carry.
  if (!isLegalMove(from?.id, to.id, edges)) {
    throw new Error(`${from?.name || "This stage"} cannot move straight to ${to.name}.`);
  }

  // 1. Evaluate Stage Conditions for the stage being left — from the SOR's
  // own snapshot; only the per-deal evidence (attachments, members, status
  // rows) is read live, since that's evidence about the deal, not the flow.
  const conditionsForFrom = conditionsForSnapshotStage(snapshotConditions, from.id);
  const currentVisit = await currentVisitFor(existing.id);
  const { attachments, members, statusRowsByCondition } = await gateEvidenceFor(
    existing.id,
    conditionsForFrom,
    { stageVisitId: currentVisit?.id },
  );

  // 0. Stage Fields (issue #203, story 21/24): a required field left blank
  // refuses the move before conditions are even checked, naming what's
  // empty — "Fill in: …". Custom fields are read from this visit's saved
  // values; an `sor`-source field reads the SOR itself (it writes straight
  // through the single-field save, never through a visit row).
  const fieldsForFrom = (snapshotStageFields || []).filter((f) => f.stage_id === from.id);
  let visitValues = {};
  if (fieldsForFrom.some((f) => f.source === "custom") && currentVisit) {
    const { data: valueRows, error: valuesError } = await supabase
      .from("sor_stage_field_values")
      .select("field_id, value")
      .eq("stage_visit_id", currentVisit.id);
    if (valuesError) throw valuesError;
    for (const row of valueRows || []) visitValues[row.field_id] = row.value;
  }
  const missingFields = missingStageFields(fieldsForFrom, { opportunity: existing, visitValues });
  if (missingFields.length > 0) {
    const error = new Error(`Fill in: ${missingFields.map((f) => f.label).join(", ")}.`);
    error.isGateBlock = true;
    error.missingStageFields = missingFields;
    throw error;
  }

  const missing = [];
  const conditions = blockingConditions(conditionsForFrom);
  const hasInclusions = await resolveHasInclusions(conditions, existing.id);
  const hasPurchasing = await resolveHasPurchasing(conditions, existing.id);

  for (const condition of conditions) {
    const result = evaluateCondition(condition, {
      opportunity: existing,
      attachments,
      members,
      statusRow: statusRowsByCondition[condition.id] ?? null,
      hasInclusions,
      hasPurchasing,
    });
    if (result.status === CONDITION_STATUS.UNSATISFIED) {
      missing.push({ stage: from, condition });
    }
  }

  if (missing.length > 0) {
    // Named, not generic — a "required items missing" toast with nothing
    // named in it sends whoever is blocked hunting for what changed. A
    // condition's optional reference link (issue #50's own config) rides
    // along here too, since a toast is the only surface a Flow deal's
    // stage control has for a blocked move.
    const details = missing
      .map(({ condition }) => {
        const link = condition.config?.referenceLink;
        return link ? `${condition.label} (${link})` : condition.label;
      })
      .join(", ");
    const error = new Error(`Cannot leave ${from.name} — missing: ${details}.`);
    error.isGateBlock = true;
    error.missingConditions = missing;
    throw error;
  }

  // 2. Perform move
  //
  // `status` is deliberately left alone here. It still holds a
  // crm_pipeline_stages code (see isRealizedOpportunity's comment above), and
  // the requireSalesReferenceOnStageMove trigger (migration 0011) fires
  // whenever `status` changes on UPDATE — writing a flow Stage's name into it
  // makes that trigger read the move as a global-pipeline transition and
  // demand a Sales Reference to "leave Lead", which a Sales Flow move was
  // never subject to. Display code that wants the current flow Stage's name
  // reads `flow_stage_id` against the loaded flow, not `status`.
  const patch = { flow_stage_id: to.id };

  if (wonStageId === to.id && !existing.contract_date) {
    patch.contract_date = getCurrentLocalDate();
  }

  const { data, error } = await supabase
    .from("sales_opportunities")
    .update(patch)
    .eq("id", existing.id)
    .select(PARTICIPANT_SELECT)
    .single();
  if (error) throw error;

  const fromName = from?.name || "—";
  await opportunityService.addSystemNote(
    existing.id,
    `Stage moved: ${fromName} → ${to.name}`,
    { event: "STAGE_CHANGED", from: from?.id ?? null, to: to.id, employeeId: actorId },
    actorId,
  );

  systemAuditLogService.addSystemEvent(
    "OPPORTUNITY",
    existing.id,
    `${auditLabel(existing)}: ${fromName} → ${to.name}`,
    { event: "STAGE_CHANGED", from: from?.id ?? null, to: to.id, employeeId: actorId },
    actorId,
  ).catch(console.error);

  // 2b. Issue #204 Part 2 — leaving a Stage skips any of its still-`pending`
  // "When confirmed" runs: they were never decided while the deal sat here,
  // and re-entering later must not re-offer them (the unique constraint on
  // sor_action_runs is per (opportunity, stage, action), not per-visit, so
  // this also guarantees story 19 — a skipped action isn't re-offered on
  // loop-back).
  if (currentVisit) {
    const { data: pendingRuns, error: pendingRunsError } = await supabase
      .from("sor_action_runs")
      .select("id, action_id")
      .eq("stage_visit_id", currentVisit.id)
      .eq("outcome", "pending");
    if (pendingRunsError) {
      console.error("Failed to load pending action runs:", pendingRunsError);
    } else {
      for (const pendingRun of pendingRuns || []) {
        const { error: skipError } = await supabase.rpc("sor_finish_action_run", {
          p_run_id: pendingRun.id,
          p_outcome: "skipped",
        });
        if (skipError) {
          console.error("sor_finish_action_run (auto-skip) failed:", skipError);
          continue;
        }
        await opportunityService.addSystemNote(
          existing.id,
          `Not created: left ${fromName} undecided.`,
          { event: "ACTION_RUN_SKIPPED", stageId: from.id, actionId: pendingRun.action_id, runId: pendingRun.id },
          actorId,
        ).catch(() => {});
      }
    }
  }

  // 3. Execute Stage Actions (Automations) for the new stage — read from the
  // SOR's own snapshot (issue #83), not the live table, so entering a Stage
  // fires the automations agreed at registration time and not ones added
  // since.
  //
  // Issue #199 — awaited, not detached: the move resolves once its actions
  // have run, so the caller's refresh already sees the tasks. The move is
  // committed above and a failing action never undoes it; each action is
  // tried on its own and failures come back named on the result.
  const failedStageActions = [];
  let actionsAttempted = false;
  try {
    const actions = actionsForSnapshotStage(snapshotActions, to.id);
    if (actions.length > 0) {
      // Issue #204 Part 2 — fire-once per (deal, stage, action) now lives in
      // sor_action_runs, gated by sor_begin_action_run's upsert-if-absent.
      // This replaces both the old STAGE_ACTIONS_FIRED log marker and the
      // ILIKE-on-description fallback.
      const newVisit = await currentVisitFor(existing.id).catch(() => null);

      actionsAttempted = true;
      // Issue #204 — template context shared by title/description rendering
      // for every action on this Stage entry. Kept in sync with
      // TEMPLATE_VARIABLES in src/constants/taskTemplates.js.
      const templateContext = {
        salesReference: existing.sales_reference,
        projectTitle: existing.project_title,
        company: existing.client_name,
        stageName: to.name,
        dealOwnerName: existing.deal_owner_name || existing.owner_name || null,
        saleType: existing.sale_type || null,
      };

      for (const action of actions) {
        const config = action.config || {};
        // Issue #178 — both automation kinds name their task after the
        // deal, not the Stage, via this one shared builder.
        const dealTitle = stageActionTaskTitle({
          salesReference: existing.sales_reference,
          projectTitle: existing.project_title,
        });

        // Issue #204 Part 2 — fire-once gate. sor_begin_action_run upserts
        // if absent and always returns the row for (opportunity, stage,
        // action); if it already existed (any outcome), this action has
        // already been handled for this deal+stage and is skipped. A
        // "When confirmed" action's decider selectors are stored on the run
        // right away so sor_decide_action_run can validate against them.
        // Spec: "the Deal Owner by default" — an unset decider is not "no
        // one may decide", it's the default selector.
        const deciderSelectors = config.decider?.length
          ? config.decider
          : [{ type: "role", role: "deal_owner" }];
        const { data: run, error: runError } = await supabase.rpc("sor_begin_action_run", {
          p_opportunity_id: existing.id,
          p_stage_id: to.id,
          p_action_id: action.id,
          p_stage_visit_id: newVisit?.id ?? null,
          p_decider: config.confirmMode === "confirm" ? deciderSelectors : null,
        });
        if (runError) {
          console.error("sor_begin_action_run failed:", runError);
          failedStageActions.push(stageActionName(action));
          continue;
        }
        const runRow = Array.isArray(run) ? run[0] : run;
        if (!runRow || runRow.outcome !== "pending") {
          // Already begun previously (created/skipped/failed) — fire-once.
          continue;
        }

        if (config.confirmMode === "confirm") {
          // Issue #204 Part 2 — "When confirmed": no task yet. Notify the
          // Deciders and leave the run pending; PendingActionDecisions.jsx
          // (or decideAction) resolves it later.
          await notifyDeciders(action, existing, to, actorId, dealTitle, deciderSelectors).catch((err) =>
            console.error("notifyDeciders failed:", err),
          );
          continue;
        }

        await buildAndCreateActionTask(action, existing, to, actorId, runRow, templateContext, failedStageActions);
      }
    }
  } catch (err) {
    // Reading the guard or loading a service failed before any action ran:
    // every action on this Stage is then unaccounted for.
    console.error("Failed to execute stage actions:", err);
    if (!actionsAttempted) {
      for (const action of actionsForSnapshotStage(snapshotActions, to.id)) {
        const name = stageActionName(action);
        if (!failedStageActions.includes(name)) failedStageActions.push(name);
      }
    }
  }

  return { ...data, failedStageActions };
}

/**
 * Issue #204 Part 2 — resolves a "When confirmed" action's `config.decider`
 * selectors (resolvePeople.js's shape: {type:'employee'|'group', id}) to
 * live employee ids, for both the notify-on-pending step and the client-side
 * refusal in `decideAction` (defense in depth — `sor_decide_action_run`'s
 * own check is the real gate).
 */
async function resolveDeciderIds(deciderSelectors, opportunity) {
  if (!deciderSelectors || deciderSelectors.length === 0) return [];
  const [{ data: employees, error: employeesError }, groups] = await Promise.all([
    supabase.from("employees").select("id, sub_department, is_deleted"),
    employeeGroupService.list(),
  ]);
  if (employeesError) throw employeesError;
  const groupMembersById = {};
  for (const group of groups) {
    groupMembersById[group.id] = { employeeIds: group.employeeIds, teams: group.teams };
  }
  return resolvePeople(deciderSelectors, {
    employees: employees || [],
    groupMembersById,
    opportunity,
  });
}

/**
 * Issue #204 Part 3 — resolves a Follow-up Cadence's `recipients` selectors
 * to live employee ids, the same shape `resolveDeciderIds` resolves a
 * "When confirmed" action's Decider — kept separate rather than shared so a
 * change to one selector list's resolution never silently changes the
 * other's.
 */
async function resolveSelectorIds(selectors, opportunity) {
  if (!selectors || selectors.length === 0) return [];
  const [{ data: employees, error: employeesError }, groups] = await Promise.all([
    supabase.from("employees").select("id, sub_department, is_deleted"),
    employeeGroupService.list(),
  ]);
  if (employeesError) throw employeesError;
  const groupMembersById = {};
  for (const group of groups) {
    groupMembersById[group.id] = { employeeIds: group.employeeIds, teams: group.teams };
  }
  return resolvePeople(selectors, {
    employees: employees || [],
    groupMembersById,
    opportunity,
  });
}

/** Every employee id on `opportunity`'s Deal Team (resolvePeople.js's DEAL_TEAM_ROLES columns), deduplicated. */
function dealTeamIds(opportunity) {
  const ids = new Set();
  for (const { columns } of Object.values(DEAL_TEAM_ROLES)) {
    for (const column of columns) {
      if (opportunity[column] != null) ids.add(String(opportunity[column]));
    }
  }
  return [...ids];
}

/**
 * Issue #204 Part 2 — notifies every Decider of a newly-pending "When
 * confirmed" action, once, when `sor_begin_action_run` first creates the
 * run (never on a subsequent gate-hit, since the run is no longer pending).
 */
async function notifyDeciders(action, existing, to, actorId, dealTitle, deciderSelectors) {
  const deciderIds = await resolveDeciderIds(deciderSelectors, existing);
  for (const recipientId of deciderIds) {
    await notificationService
      .createNotification({
        recipient_id: recipientId,
        sender_id: actorId,
        type: "OPPORTUNITY_ACTION_DECISION_DUE",
        title: stageActionName(action) || dealTitle,
        message: `A Stage Action on "${existing.project_title || dealTitle}" (${to.name}) needs your decision: Create or Skip.`,
        reference_id: existing.id,
      })
      .catch((err) => console.error("notifyDeciders failed:", err));
  }
}

/**
 * Issue #204 Part 2 — the one place either action kind's title is derived
 * from its config, shared by `buildAndCreateActionTask` (what Create
 * actually builds) and `getPendingActionsForActor` (the Decider card's
 * preview of what Create will build) so the two can never drift apart —
 * spec: "Create makes exactly what the automatic action would."
 */
function renderActionTitle(action, templateContext) {
  const config = action.config || {};
  const dealTitle = stageActionTaskTitle({
    salesReference: templateContext.salesReference,
    projectTitle: templateContext.projectTitle,
  });
  if (action.kind === "create_group_task") {
    return config.titleTemplate || config.title ? renderTemplate(config.titleTemplate || config.title, templateContext) : dealTitle;
  }
  return config.titleTemplate || config.projectTitle ? renderTemplate(config.titleTemplate || config.projectTitle, templateContext) : dealTitle;
}

/**
 * Issue #204 Part 2 — the ONE builder both the automatic path (moveAlongFlow's
 * action loop) and the "create" half of `decideAction` call, so a decided
 * Create produces exactly what an automatic run would have. Performs the
 * side effects (task creation, sor_finish_action_run, system note) and
 * pushes onto `failedStageActions` on failure.
 */
async function buildAndCreateActionTask(action, existing, to, actorId, runRow, templateContext, failedStageActions) {
  const config = action.config || {};

  if (action.kind === "create_group_task") {
    const { groupTaskService } = await import("./groupTaskService");
    const payload = {
      title: renderActionTitle(action, templateContext),
      description: config.descriptionTemplate || config.description
        ? renderTemplate(config.descriptionTemplate || config.description, templateContext)
        : "",
      createdBy: actorId,
      templateId: config.templateId || null,
      members: config.members?.length > 0 ? config.members : [{ employeeId: actorId, role: "Assignee", taskDescription: "Complete action" }],
      opportunityId: existing.id,
      stageActionId: action.id,
      stageVisitId: runRow?.stage_visit_id ?? null,
      tagIds: config.tagIds || [],
    };
    if (config.dueDateOffsetDays) {
      const due = new Date();
      due.setDate(due.getDate() + parseInt(config.dueDateOffsetDays));
      payload.dueDate = due.toISOString();
    }

    const groupTask = await groupTaskService.createGroupTask(payload).catch((err) => {
      console.error("Stage Action failed:", err);
      failedStageActions?.push(stageActionName(action));
      return null;
    });

    const groupTaskId = groupTask ? (groupTask.id ?? groupTask.data?.id ?? null) : null;
    const { error: finishError } = await supabase.rpc("sor_finish_action_run", {
      p_run_id: runRow.id,
      p_outcome: groupTask ? "created" : "failed",
      p_group_task_id: groupTaskId,
    });
    if (finishError) console.error("sor_finish_action_run failed:", finishError);

    if (groupTask) {
      await opportunityService.addSystemNote(
        existing.id,
        `Group Task "${payload.title}" created on entering Stage: ${to.name}.`,
        { event: "STAGE_ACTION_TASK_CREATED", stageId: to.id, actionId: action.id, groupTaskId },
        actorId
      ).catch(() => {});

      // Issue #294: every assignee/member on this action task becomes a
      // Stage Participant, windowed by the action's own `config.access`.
      if (runRow?.stage_visit_id) {
        for (const member of payload.members) {
          if (!member?.employeeId) continue;
          await sorStageParticipantService.openWindow(
            {
              opportunityId: existing.id,
              employeeId: member.employeeId,
              source: "action",
              sourceId: action.id,
              openedVisitId: runRow.stage_visit_id,
              access: config.access,
            },
            actorId,
          ).catch((err) => console.error("openWindow failed for action task:", err));
        }
      }
    }
  } else if (action.kind === "create_individual_task") {
    const { taskService } = await import("./taskService");
    const title = renderActionTitle(action, templateContext);
    // Back-compat: an individual-task automation's config.title never named
    // the task's title (that's config.projectTitle/titleTemplate — see the
    // comment on projectTitle below) but it did name the task's
    // description in the pre-#204 builder. Kept so an existing automation's
    // saved config.title still shows up somewhere on the created task.
    const description = config.descriptionTemplate || config.description
      ? renderTemplate(config.descriptionTemplate || config.description, templateContext)
      : config.title
        ? renderTemplate(config.title, templateContext)
        : "";
    const payload = {
      taskDescription: description || title,
      categoryId: config.categoryId,
      priority: config.priority || "MEDIUM",
      checklist: config.checklist || null,
      projectTitle: title,
      loggedById: config.loggedById || actorId,
      submittedById: actorId,
      opportunityId: existing.id,
      stageActionId: action.id,
      stageVisitId: runRow?.stage_visit_id ?? null,
    };
    if (config.dueOffsetDays) {
      const due = new Date();
      due.setDate(due.getDate() + parseInt(config.dueOffsetDays));
      payload.endAt = due.toISOString();
    }

    const task = await taskService.createTask(payload).catch((err) => {
      console.error("Stage Action failed:", err);
      failedStageActions?.push(stageActionName(action));
      return null;
    });

    const taskId = task ? (task.id ?? task.data?.id ?? null) : null;
    const { error: finishError } = await supabase.rpc("sor_finish_action_run", {
      p_run_id: runRow.id,
      p_outcome: task ? "created" : "failed",
      p_task_id: taskId,
    });
    if (finishError) console.error("sor_finish_action_run failed:", finishError);

    if (task) {
      await opportunityService.addSystemNote(
        existing.id,
        `Task "${title}" created on entering Stage: ${to.name}.`,
        { event: "STAGE_ACTION_TASK_CREATED", stageId: to.id, actionId: action.id, taskId },
        actorId
      ).catch(() => {});

      // Issue #294: the task's assignee becomes a Stage Participant.
      if (runRow?.stage_visit_id && payload.loggedById) {
        await sorStageParticipantService.openWindow(
          {
            opportunityId: existing.id,
            employeeId: payload.loggedById,
            source: "action",
            sourceId: action.id,
            openedVisitId: runRow.stage_visit_id,
            access: config.access,
          },
          actorId,
        ).catch((err) => console.error("openWindow failed for action task:", err));
      }
    }
  } else {
    // No branch matched this action's kind. Before this existed the run row
    // stayed `pending` forever: nothing was created, nothing was named to
    // the person who moved the SOR, and the fire-once gate meant re-entering
    // the Stage would not retry it either. A kind this builder does not
    // implement is a defect, so it fails loudly and lands in the same "create
    // them by hand" toast a failed create already uses.
    console.error("Stage Action has no builder for kind:", action.kind);
    failedStageActions?.push(stageActionName(action));
    const { error: finishError } = await supabase.rpc("sor_finish_action_run", {
      p_run_id: runRow.id,
      p_outcome: "failed",
    });
    if (finishError) console.error("sor_finish_action_run failed:", finishError);
  }
}

/** How a failed Stage Action is named to the person who moved the SOR. */
function stageActionName(action) {
  const config = action?.config ?? {};
  const named = config.title || config.projectTitle;
  if (typeof named === "string" && named.trim()) return named.trim();
  return action?.kind === "create_group_task" ? "Group task" : "Individual task";
}

function currentStageId(opportunity) {
  return opportunity?.flow_stage_id || opportunity?.status;
}

/**
 * D42 — a `deadline` condition's "entry into the Stage" timestamp: the
 * most recent STAGE_CHANGED note landing this opportunity on its current
 * Stage (`metadata.to`), the same note `updateStatus` already writes on
 * every move. A deal still sitting on its very first Stage never got one —
 * nothing moved it there — so its own `created_at` stands in. No new
 * timestamp column, per D42.
 */
function stageEnteredAt(opportunity, logs) {
  const entries = (logs || [])
    .filter(
      (log) => log.metadata?.event === "STAGE_CHANGED" && log.metadata?.to === currentStageId(opportunity),
    )
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return entries[0]?.created_at || opportunity.created_at;
}

/**
 * Every active `deadline` condition on each of the given opportunities'
 * own current Stage, evaluated against "now" (`deadlineStatus`, ticket 1).
 * Shared by the board countdown (`getDeadlineStatuses`) and the
 * approach/breach notification check (`checkDeadlineNotifications`, ticket
 * 7) so both read the same evaluation rather than each re-deriving it —
 * same reasoning as `gateContext` for the blocking kinds.
 *
 * Returns `{ [opportunityId]: Array<{ condition, daysRemaining, isBreached,
 * isApproaching }> }` — a Stage carrying more than one `deadline`
 * condition is unusual (the spec's own examples never configure two on
 * the same Stage) but not disallowed, so this returns all of them rather
 * than assuming one.
 */
async function deadlineEvaluations(opportunities) {
  if (opportunities.length === 0) return {};
  // Stage Conditions only ever hang off Sales Flow Stages, so only a deal
  // carrying a `flow_stage_id` can have one. A legacy pipeline deal's
  // `status` is a code ("LEAD"), never a `flow_stages.id`, and feeding it
  // into this uuid IN-list is what made the board's first read 22P02 —
  // same reasoning as `getBlockedDeals`. Legacy deals fall through with no
  // deadline entry, which is what "no Stage Conditions" already means.
  const stageIds = [...new Set(opportunities.map((o) => o.flow_stage_id).filter(Boolean))];
  if (stageIds.length === 0) return {};

  const { conditions, conditionsByStage } = await conditionsByStageFor(stageIds, (query) =>
    query.eq("kind", CONDITION_KINDS.DEADLINE),
  );
  if (conditions.length === 0) return {};

  const opportunityIds = opportunities.map((o) => o.id);
  const { data: logs, error: logsError } = await supabase
    .from("sales_opportunity_logs")
    .select("opportunity_id, created_at, metadata")
    .in("opportunity_id", opportunityIds);
  if (logsError) throw logsError;

  const logsByOpportunity = groupBy(logs, "opportunity_id");

  const now = new Date().toISOString();
  const result = {};
  for (const opportunity of opportunities) {
    const stageConditions = conditionsByStage[currentStageId(opportunity)];
    if (!stageConditions || stageConditions.length === 0) continue;

    const enteredAt = stageEnteredAt(opportunity, logsByOpportunity[opportunity.id]);
    result[opportunity.id] = stageConditions.map((condition) => ({
      condition,
      ...deadlineStatus(condition, { enteredAt, asOf: now }),
    }));
  }
  return result;
}

/** The two milestones `checkDeadlineNotifications` can fire, and how each reads — one place instead of branching on `isBreached` three separate times. */
const DEADLINE_MILESTONES = {
  BREACHED: {
    title: "Deadline passed",
    describe: (label, stageLabel, daysRemaining) =>
      `Deadline passed: "${label}" (${stageLabel}), ${Math.abs(daysRemaining)} day(s) ago.`,
  },
  APPROACHING: {
    title: "Deadline approaching",
    describe: (label, stageLabel, daysRemaining) =>
      `Deadline approaching: "${label}" (${stageLabel}), ${daysRemaining} day(s) left.`,
  },
};

/**
 * How an opportunity is named in the GLOBAL audit log, which mixes records
 * from every module and so needs to identify which one it is talking about.
 *
 * The Odoo Sales Reference is the only external number this product carries —
 * the retired opportunity_no shared its S0#### format and pointed at unrelated
 * Odoo orders (see migration 0012). A deal has no reference until it leaves
 * the Lead stage, so before then it is named by client instead.
 *
 * Per-opportunity timeline notes deliberately carry no identifier at all:
 * they are already displayed inside the record they describe.
 */
function auditLabel({ sales_reference, client_name }) {
  return sales_reference
    ? `Sales opportunity ${sales_reference}`
    : `Sales opportunity for ${client_name}`;
}

/**
 * Every non-deleted SOR pinned to an earlier Flow Snapshot of the same
 * major as `targetSnapshotId` — the candidate set for "Move N SORs on 3.x
 * up to 3.2" (issue #190). Scratch SORs are deliberately included: they run
 * identical Sales Flow code, so the `is_scratch` exclusion this file applies
 * elsewhere does not apply to a version move.
 */
async function eligibleOpportunityIdsForVersionMove(targetSnapshotId) {
  const { data: targetSnapshot, error: snapshotError } = await supabase
    .from("flow_snapshots")
    .select("id, flow_id, version, version_minor")
    .eq("id", targetSnapshotId)
    .single();
  if (snapshotError) throw snapshotError;

  const { data: earlierSnapshots, error: earlierError } = await supabase
    .from("flow_snapshots")
    .select("id")
    .eq("flow_id", targetSnapshot.flow_id)
    .eq("version", targetSnapshot.version)
    .lt("version_minor", targetSnapshot.version_minor);
  if (earlierError) throw earlierError;

  const earlierIds = (earlierSnapshots || []).map((s) => s.id);
  if (earlierIds.length === 0) return [];

  const { data: deals, error: dealsError } = await supabase
    .from("sales_opportunities")
    .select("id")
    .in("flow_snapshot_id", earlierIds)
    .neq("is_deleted", true);
  if (dealsError) throw dealsError;

  return (deals || []).map((d) => d.id);
}

export const opportunityService = {
  /**
   * The SOR Register. Every register count, the board, the matrix, and the
   * batched blocked-deal and deadline reads all take this list as their
   * input, which makes it the one place the Scratch SOR exclusion has to be
   * right (issue #36, migration 0046). A Scratch SOR runs identical code
   * paths to a real deal, so nothing else here can tell them apart.
   *
   * `getOpportunityById` deliberately does NOT filter: the canvas opens a
   * Scratch SOR to watch it, and a record that cannot be opened cannot be
   * watched.
   */
  async getOpportunities() {
    const { data, error } = await supabase
      .from("sales_opportunities")
      .select(PARTICIPANT_SELECT)
      .neq("is_deleted", true)
      .eq("is_scratch", false)
      .eq("is_retail", false)
      .order("registration_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * The Retail tab (issue #174) — the same table as getOpportunities, flag
   * inverted. No new table: a retail record is a real SOR with a real
   * sales_reference and amount, just excluded from the pipeline (#171).
   */
  async getRetailOpportunities() {
    const { data, error } = await supabase
      .from("sales_opportunities")
      .select(
        "id, sales_reference, client_name, project_title, expected_value, registration_date, lead_source, created_at",
      )
      .neq("is_deleted", true)
      .eq("is_retail", true)
      .order("registration_date", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getOpportunityById(id) {
    if (!id) return null;
    const { data, error } = await supabase
      .from("sales_opportunities")
      .select(PARTICIPANT_SELECT)
      .eq("id", id)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * How a task names the SOR it was created for: the Sales Reference, else the
   * Company (issue #199). Null when the SOR can't be read. Kept narrow so a
   * task modal can resolve it without depending on how the task was loaded.
   */
  async getOpportunityLinkLabel(id) {
    if (!id) return null;
    const { data, error } = await supabase
      .from("sales_opportunities")
      .select("sales_reference, client_name")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? data.sales_reference || data.client_name || null : null;
  },

  /**
   * Registers a new opportunity. `opportunity_no` is deliberately NOT sent —
   * a BEFORE INSERT trigger assigns it from a Postgres sequence so concurrent
   * registrations cannot collide.
   */
  async createOpportunity(payload, actorId) {
    // Issue #36 — a deal registered against a Sale Type enters that Sale
    // Type's flow at its first Stage. Both columns are set together or neither
    // is (migration 0049's CHECK), because a deal with a Sale Type and no
    // Stage in its flow is a deal nothing can move.
    //
    // Issue #83 — that flow is its Sale Type's most recently locked Flow
    // Snapshot, not the live tables: registering against a flow that has
    // never been locked fails clearly (entryStageFor/latestSnapshotFor)
    // rather than silently pinning to nothing.
    const flowEntry = payload.sale_type_id ? await entryStageFor(payload.sale_type_id) : null;

    const { data, error } = await supabase
      .from("sales_opportunities")
      .insert({
        sale_type_id: payload.sale_type_id || null,
        flow_stage_id: flowEntry?.entry?.id || null,
        flow_snapshot_id: flowEntry?.snapshot?.id || null,
        registration_date: payload.registration_date,
        registered_by: actorId,
        lead_source: payload.lead_source,
        lead_source_detail: payload.lead_source_detail || null,
        client_name: payload.client_name,
        odoo_partner_id: payload.odoo_partner_id ?? null,
        contact_person: payload.contact_person || null,
        project_title: payload.project_title,
        project_type: deriveProjectType({
          supportSales1Id: payload.support_sales_1_id,
          supportSales2Id: payload.support_sales_2_id,
          currentProjectType: payload.project_type,
        }),
        sales_reference: cleanSalesReference(payload.sales_reference),
        metadata: payload.metadata || null,
        expected_award_date: payload.expected_award_date || null,
        po_date: payload.po_date || null,
        deal_owner_id: payload.deal_owner_id || null,
        closing_sales_id: payload.closing_sales_id || null,
        support_sales_1_id: payload.support_sales_1_id || null,
        support_sales_2_id: payload.support_sales_2_id || null,
        sales_director_id: payload.sales_director_id || null,
        status: payload.status || "LEAD",
      })
      .select(PARTICIPANT_SELECT)
      .single();

    if (error) throw error;

    // expected_value is trigger-maintained from the product list — insert the
    // items first, then re-read the row to pick up the computed total before
    // it's quoted in the notes below.
    await opportunityService.replaceItems(data.id, payload.items);

    // The flow's custom registration fields, answered on the form that this
    // Sale Type's Flow Snapshot defines. Written separately for the same
    // reason `items` is: the insert above is an explicit column whitelist, so
    // anything not a column on sales_opportunities has to be persisted on its
    // own or it is silently dropped. A default-source field is NOT written
    // here — it already went in above, as the column it is.
    if (payload.formValues && Object.keys(payload.formValues).length > 0) {
      const { formFieldService } = await import("./formFieldService");
      await formFieldService.saveValues(data.id, payload.formValues, actorId);
    }

    // Issue #294: entry-Stage Assignment conditions render as People Pickers
    // on this same form (RegistrationField's "assignment" case) — answering
    // one is the same call-in `addMember` already handles for a checklist
    // row, just made on day one instead of later on the SOR. Reuses that one
    // path rather than a second "day-one participant" writer, so the window
    // it opens and the notification it sends are the same either way.
    if (payload.dayOneAssignments && Object.keys(payload.dayOneAssignments).length > 0) {
      for (const [conditionId, employeeId] of Object.entries(payload.dayOneAssignments)) {
        if (!employeeId) continue;
        await opportunityService.addMember(data.id, employeeId, actorId, { conditionId }).catch((err) =>
          console.error("Day-one Assignment addMember failed:", err),
        );
      }
    }

    const final = await opportunityService.getOpportunityById(data.id);

    await opportunityService.addSystemNote(
      final.id,
      `Registered — ${final.client_name}, ${formatPHP(final.expected_value)}.`,
      { event: "OPPORTUNITY_REGISTERED", employeeId: actorId },
      actorId,
    );

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      final.id,
      `Sales opportunity registered for ${final.client_name} (${formatPHP(final.expected_value)}).`,
      { event: "OPPORTUNITY_REGISTERED", employeeId: actorId },
      actorId,
    ).catch(console.error);

    return final;
  },

  async updateOpportunity(id, payload, actorId) {
    const existing = await opportunityService.getOpportunityById(id);
    const existingItems = await opportunityService.getItems(id);

    // Issue #199 — a patch, not a replacement. A field left out of `payload`
    // is left alone; a field sent empty is cleared. The full-replace contract
    // was invisible at the call site, and a one-field Stage Checklist Save
    // wiped the Deal Team, the Product List and every date with it.
    // `undefined` reads as absent — JSON drops it on the wire anyway.
    const has = (key) => payload[key] !== undefined;
    const patch = {};
    for (const [key, write] of Object.entries(RECORD_FIELD_WRITERS)) {
      if (has(key)) patch[key] = write(payload[key]);
    }
    if (has("client_name") || has("sales_reference")) {
      patch.odoo_partner_id = resolveOdooPartner(existing, {
        client_name: existing.client_name,
        ...payload,
      });
    }
    if (has("project_type") || has("support_sales_1_id") || has("support_sales_2_id")) {
      const pick = (key) => (has(key) ? payload[key] : existing[key]);
      patch.project_type = deriveProjectType({
        supportSales1Id: pick("support_sales_1_id"),
        supportSales2Id: pick("support_sales_2_id"),
        currentProjectType: pick("project_type"),
      });
    }
    if (has("metadata")) patch.metadata = payload.metadata;

    let data = existing;
    if (Object.keys(patch).length > 0) {
      const result = await supabase
        .from("sales_opportunities")
        .update(patch)
        .eq("id", id)
        .select(PARTICIPANT_SELECT)
        .single();
      if (result.error) throw result.error;
      data = result.data;
    }

    const replacesItems = has("items");
    if (replacesItems) await opportunityService.replaceItems(id, payload.items);
    const final = await opportunityService.getOpportunityById(id);

    // Change notes compare only what the payload carried, plus the derived
    // fields that follow it.
    const touched = new Set(Object.keys(patch));
    const changes = [];
    const checkField = (field, label) => {
      if (touched.has(field) && existing[field] !== final[field]) {
        changes.push(`${label} changed from "${existing[field] || 'None'}" to "${final[field] || 'None'}"`);
      }
    };

    checkField('lead_source', 'Lead Source');
    checkField('lead_source_detail', 'Referral');
    checkField('client_name', 'Company');
    checkField('contact_person', 'Contact Person');
    checkField('project_title', 'Project');
    checkField('project_type', 'Sales Division');
    checkField('sales_reference', 'Sales Reference');
    
    // Check metadata fields dynamically
    const oldMeta = touched.has("metadata") ? existing.metadata || {} : {};
    const newMeta = touched.has("metadata") ? final.metadata || {} : {};
    const allMetaKeys = new Set([...Object.keys(oldMeta), ...Object.keys(newMeta)]);
    for (const key of allMetaKeys) {
      if (oldMeta[key] !== newMeta[key]) {
        const from = oldMeta[key] ? `"${oldMeta[key]}"` : "nothing";
        const to = newMeta[key] ? `"${newMeta[key]}"` : "nothing";
        changes.push(`${key} from ${from} to ${to}`);
      }
    }

    checkField('expected_award_date', 'Expected Award Date');
    checkField('po_date', 'PO Date');

    const checkEmployee = (idField, objField, label) => {
      if (touched.has(idField) && existing[idField] !== final[idField]) {
        const oldName = existing[objField]?.name || 'None';
        const newName = final[objField]?.name || 'None';
        changes.push(`${label} changed from "${oldName}" to "${newName}"`);
      }
    };

    checkEmployee('deal_owner_id', 'deal_owner', 'Deal Owner');
    checkEmployee('closing_sales_id', 'closing_sales', 'Closing Salesperson');
    checkEmployee('sales_director_id', 'sales_director', 'Sales Director');
    checkEmployee('support_sales_1_id', 'support_1', 'Support Sales 1');
    checkEmployee('support_sales_2_id', 'support_2', 'Support Sales 2');

    const newItems = replacesItems ? payload.items || [] : existingItems;
    const oldProducts = existingItems.map((i) => i.product_name?.trim()).filter(Boolean);
    const newProducts = newItems.map((i) => i.product_name?.trim()).filter(Boolean);

    const addedProducts = newProducts.filter((p) => !oldProducts.includes(p));
    const removedProducts = oldProducts.filter((p) => !newProducts.includes(p));
    const modifiedProducts = [];

    newProducts.forEach((p) => {
      const oldItem = existingItems.find((i) => i.product_name?.trim() === p);
      const newItem = newItems.find((i) => i.product_name?.trim() === p);
      if (oldItem && newItem) {
        if (
          Number(oldItem.quantity) !== Number(newItem.quantity) ||
          Number(oldItem.unit_price) !== Number(newItem.unit_price) ||
          (oldItem.unit || "") !== (newItem.unit || "").trim()
        ) {
          modifiedProducts.push(p);
        }
      }
    });

    const addedNames = addedProducts.map(stripProductCode);
    const removedNames = removedProducts.map(stripProductCode);
    const modifiedNames = modifiedProducts.map(stripProductCode);

    if (addedNames.length > 0) changes.push(`Added product(s): ${addedNames.join(', ')}`);
    if (removedNames.length > 0) changes.push(`Removed product(s): ${removedNames.join(', ')}`);
    if (modifiedNames.length > 0) changes.push(`Modified product(s): ${modifiedNames.join(', ')}`);

    if (Number(existing.expected_value) !== Number(final.expected_value)) {
      changes.push(`Expected Value changed from ₱${Number(existing.expected_value).toLocaleString()} to ₱${Number(final.expected_value).toLocaleString()}`);
    }

    if (changes.length > 0) {
      const diffString = changes.join(", ");
      const productChanges = [
        ...addedNames.map((name) => ({ type: "added", name })),
        ...removedNames.map((name) => ({ type: "removed", name })),
        ...modifiedNames.map((name) => ({ type: "modified", name })),
      ];

      await opportunityService.addSystemNote(
        id,
        `Details updated: ${diffString}`,
        { event: "OPPORTUNITY_UPDATED", employeeId: actorId, changes, productChanges },
        actorId,
      );

      systemAuditLogService.addSystemEvent(
        "OPPORTUNITY",
        id,
        `${auditLabel(data)} details updated: ${diffString}`,
        { event: "OPPORTUNITY_UPDATED", employeeId: actorId, changes },
        actorId,
      ).catch(console.error);
    }

    // A `field`-kind condition on the Stage this deal is still sitting on
    // (e.g. po_date at PMS) is satisfied the moment the field is saved —
    // this call is "the existing field-save path" ticket 5 hooks into, not
    // a separate satisfaction action.
    await narrateNewlySatisfied(
      id,
      existing.flow_stage_id,
      existing.flow_snapshot_id,
      { opportunity: existing },
      { opportunity: final },
      actorId,
    );

    return final;
  },

  /**
   * The Save on a *Field on record* Stage Condition (issue #199). A real SOR
   * field is written to its column; any other key is merged into metadata
   * read fresh here, so a stale modal copy can't overwrite custom fields
   * saved elsewhere. Goes through `updateOpportunity`'s patch path, so
   * validation, derived fields and change notes match an edit-form change.
   */
  async saveRecordField(id, column, value, actorId) {
    if (Object.prototype.hasOwnProperty.call(RECORD_FIELD_WRITERS, column)) {
      return opportunityService.updateOpportunity(id, { [column]: value }, actorId);
    }
    const { data: fresh, error } = await supabase
      .from("sales_opportunities")
      .select("metadata")
      .eq("id", id)
      .single();
    if (error) throw error;
    return opportunityService.updateOpportunity(
      id,
      { metadata: { ...(fresh?.metadata || {}), [column]: value } },
      actorId,
    );
  },

  /**
   * Whether a *Field on record* condition's column can be saved from the
   * Stage Checklist (issue #199). Estimated Value is set only by the Product
   * List, people are what Assignment conditions are for, and the ITB
   * exemption is a yes/no claim a text box can't make. Custom (metadata)
   * keys are always writable.
   */
  isChecklistWritableField(column) {
    if (!column || column === "expected_value") return false;
    return !CHECKLIST_UNWRITABLE_FIELDS.has(column);
  },


  /**
   * Moves an opportunity to a new pipeline stage and records the move on its
   * timeline. `lostReason` is required when moving to CLOSED_LOST;
   * `salesReference` is required when leaving Lead and none is on record yet
   * (mirrored by a trigger — see migration 0011).
   *
   * The ITB gate that used to sit at For Bidding was removed (issue #206,
   * ADR 0004 D12) — Sales Flows replaced it. Existing `itb_number`/
   * `itb_exempt` values are kept read-only on the record; nothing writes them
   * through this path any more.
   */
  async updateStatus(
    id,
    nextStatus,
    actorId,
    lostReason = null,
    salesReference = null,
  ) {
    const { data: existing, error: readError } = await supabase
      .from("sales_opportunities")
      // Full row, not a narrow column list: a `field`-kind condition's
      // `config.column` can name any column on this table, so the Stage Gate
      // Engine check below needs whatever a Super Admin configured it to be,
      // not a fixed set decided ahead of time.
      .select("*")
      .eq("id", id)
      .single();
    if (readError) throw readError;

    // Issue #36 / ADR 0006 — the one funnel, two spaces. A deal carrying a
    // Sale Type sits on a Stage of its own Sales Flow, so `nextStatus` is a
    // flow Stage id and the move is validated against the edges the Operations
    // Manager drew. A deal without one is on the global ordered pipeline and
    // everything below this line applies to it unchanged.
    //
    // Branching here rather than adding a second public method is deliberate:
    // two ways to move an SOR is the defect that reusing this funnel prevents.
    if (existing.sale_type_id) {
      return moveAlongFlow(existing, nextStatus, actorId);
    }

    if (existing.status === nextStatus) return existing;

    const providedRef = cleanSalesReference(salesReference);

    if (
      requiresSalesReference(existing.status, nextStatus) &&
      !(providedRef || existing.sales_reference)
    ) {
      throw new Error(
        "A Sales Reference is required before this opportunity can leave Lead — enter the Odoo sales quotation number (e.g. S01237).",
      );
    }

    const patch = {
      status: nextStatus,
      lost_reason: isLostCode(nextStatus) ? lostReason : null,
    };
    const recordsRef = providedRef && providedRef !== existing.sales_reference;
    if (recordsRef) patch.sales_reference = providedRef;

    // Contract Date anchors which dated Commission Rate applies to this
    // opportunity (see commissionService.getCommissionBreakdownForOpportunity).
    // Set once, the first time an opportunity reaches Awarded — never
    // overwritten by a later transition, so a rate change afterward can't
    // move an already-priced opportunity's commission figure.
    if (isAnchorCode(nextStatus) && !existing.contract_date) {
      patch.contract_date = getCurrentLocalDate();
    }

    await assertStageGateSatisfied(id, existing.status, nextStatus, { ...existing, ...patch });

    const { data, error } = await supabase
      .from("sales_opportunities")
      .update(patch)
      .eq("id", id)
      .select(PARTICIPANT_SELECT)
      .single();

    if (error) throw error;

    if (recordsRef) {
      await opportunityService.addSystemNote(
        id,
        `Sales Reference recorded: ${providedRef}`,
        { event: "SALES_REFERENCE_SET", salesReference: providedRef, employeeId: actorId },
        actorId,
      );

      systemAuditLogService.addSystemEvent(
        "OPPORTUNITY",
        id,
        `${auditLabel(existing)}: Sales Reference recorded as ${providedRef}.`,
        { event: "SALES_REFERENCE_SET", salesReference: providedRef, employeeId: actorId },
        actorId,
      ).catch(console.error);
    }

    const from = STAGE_LABELS[existing.status] || existing.status;
    const to = STAGE_LABELS[nextStatus] || nextStatus;
    const suffix = isLostCode(nextStatus) && lostReason ? ` — ${lostReason}` : "";

    await opportunityService.addSystemNote(id, `Stage moved: ${from} → ${to}${suffix}`, {
      event: "STAGE_CHANGED",
      from: existing.status,
      to: nextStatus,
      employeeId: actorId,
    }, actorId);

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      id,
      // Uses the reference just recorded when there is one, so the audit line
      // carries the Odoo number rather than falling back to the client name.
      `${auditLabel({ ...existing, sales_reference: providedRef || existing.sales_reference })}: ${from} → ${to}${suffix}`,
      { event: "STAGE_CHANGED", from: existing.status, to: nextStatus, employeeId: actorId },
      actorId,
    ).catch(console.error);

    // Purchasing may already have committed to a supplier for this deal. They
    // are told; nothing of theirs is closed on their behalf, because a task
    // that silently vanished would take the evidence of that spend with it.
    // Fire-and-forget: losing the deal must not fail because a notification did.
    if (isLostCode(nextStatus)) {
      purchasingService
        .notifyDealClosed(id, actorId, lostReason)
        .catch(console.error);
    }

    return data;
  },

  /**
   * Re-routes a deal onto a different Sale Type's flow (issue #36).
   *
   * Permitted only before the deal's first move, and refused after it — by
   * then the deal has visited Stages the other flow does not have, and since
   * Stages are private to their flow there is no mapping that could say where
   * it belongs. The check reads the deal's history rather than its position,
   * because a flow may loop back to its own entry and sitting there again is
   * not the same as never having left.
   *
   * This also covers a legacy deal being adopted onto a flow for the first
   * time: one that has never moved can be, one that has cannot.
   *
   * The deal lands on the new flow's first Stage. That is not a fallback: it
   * is the only destination a flow with private Stages can offer.
   */
  async updateSaleType(id, saleTypeId, actorId) {
    const existing = await opportunityService.getOpportunityById(id);
    if (existing.sale_type_id === saleTypeId) return existing;

    // Asked of every deal, not only of one already on a flow. A legacy deal
    // has moved too — it has a position on the global pipeline and a history
    // behind it — and adopting it onto a flow lands it on that flow's first
    // Stage, which would throw both away.
    if (await hasEverMoved(id)) {
      throw new Error(
        "This deal has already moved past its first Stage, so its Sale Type is fixed. Its history belongs to the flow it is on.",
      );
    }

    // Issue #83 — the deal is pinned to the target Sale Type's own most
    // recently locked Flow Snapshot, the same as a fresh registration.
    const { snapshot, entry } = await entryStageFor(saleTypeId);

    const { data: saleTypes, error: nameError } = await supabase
      .from("sale_types")
      .select("id, name")
      .in("id", [saleTypeId, existing.sale_type_id].filter(Boolean));
    if (nameError) throw nameError;
    const nameOf = (typeId) => saleTypes?.find((t) => t.id === typeId)?.name || "—";

    const { data, error } = await supabase
      .from("sales_opportunities")
      .update({ sale_type_id: saleTypeId, flow_stage_id: entry.id, flow_snapshot_id: snapshot.id })
      .eq("id", id)
      .select(PARTICIPANT_SELECT)
      .single();
    if (error) throw error;

    // Both values, always: a deal's history has to explain itself, and "Sale
    // Type changed" without saying from what explains nothing.
    const change = `Sale Type changed: ${nameOf(existing.sale_type_id)} → ${nameOf(saleTypeId)}`;
    await opportunityService.addSystemNote(
      id,
      `${change}. Now at ${entry.name}.`,
      {
        event: "SALE_TYPE_CHANGED",
        from: existing.sale_type_id,
        to: saleTypeId,
        flowStageId: entry.id,
        flowSnapshotId: snapshot.id,
        employeeId: actorId,
      },
      actorId,
    );

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      id,
      `${auditLabel(existing)}: ${change}.`,
      { event: "SALE_TYPE_CHANGED", from: existing.sale_type_id, to: saleTypeId, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Moves an SOR onto a different Flow Snapshot of its own flow — the
   * explicit, audited alternative to a snapshot changing underneath a deal
   * as a side effect of someone editing a Stage (issue #83).
   *
   * Refuses when the deal's current Stage does not exist in the target
   * snapshot, rather than stranding it there. Touches `flow_snapshot_id`
   * only — never `flow_stage_id` or `contract_date` — so a move can never by
   * itself change where the deal sits or retroactively alter whether it is
   * Realized.
   */
  async moveOpportunitySnapshot(opportunityId, targetSnapshotId, actorId) {
    const existing = await opportunityService.getOpportunityById(opportunityId);
    if (!existing.sale_type_id) {
      throw new Error("This deal does not run a Sales Flow, so it has no Flow Snapshot to move.");
    }

    const { data: targetSnapshot, error: snapshotError } = await supabase
      .from("flow_snapshots")
      .select("*")
      .eq("id", targetSnapshotId)
      .single();
    if (snapshotError) throw snapshotError;

    const { data: flow, error: flowError } = await supabase
      .from("sales_flows")
      .select("id")
      .eq("sale_type_id", existing.sale_type_id)
      .single();
    if (flowError) throw flowError;

    if (targetSnapshot.flow_id !== flow.id) {
      throw new Error("That Flow Snapshot belongs to a different flow.");
    }

    const targetStages = targetSnapshot.snapshot_data?.stages || [];
    if (!targetStages.some((s) => s.id === existing.flow_stage_id)) {
      throw new Error(
        `This deal's current Stage does not exist in Flow Snapshot ${formatSnapshotVersion(targetSnapshot)}, so moving it would strand it. Move it to a different Stage first, or choose a different snapshot.`,
      );
    }

    let sourceLabel = "no Flow Snapshot";
    if (existing.flow_snapshot_id) {
      const { data: sourceSnapshot } = await supabase
        .from("flow_snapshots")
        .select("version, version_minor")
        .eq("id", existing.flow_snapshot_id)
        .maybeSingle();
      sourceLabel = sourceSnapshot ? formatSnapshotVersion(sourceSnapshot) : "an unknown Flow Snapshot";
    }

    const { data, error } = await supabase
      .from("sales_opportunities")
      .update({ flow_snapshot_id: targetSnapshot.id })
      .eq("id", opportunityId)
      .select(PARTICIPANT_SELECT)
      .single();
    if (error) throw error;

    const targetLabel = formatSnapshotVersion(targetSnapshot);

    await opportunityService.addSystemNote(
      opportunityId,
      `Flow Snapshot changed: ${sourceLabel} → ${targetLabel}.`,
      {
        event: "FLOW_SNAPSHOT_MOVED",
        from: existing.flow_snapshot_id,
        to: targetSnapshot.id,
        employeeId: actorId,
      },
      actorId,
    );

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      opportunityId,
      `${auditLabel(existing)}: Flow Snapshot changed ${sourceLabel} → ${targetLabel}.`,
      {
        event: "FLOW_SNAPSHOT_MOVED",
        from: existing.flow_snapshot_id,
        to: targetSnapshot.id,
        employeeId: actorId,
      },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * `moveOpportunitySnapshot`, for many SORs at once — adopting a revised
   * process shouldn't mean editing deals one at a time (issue #83). Collects
   * failures instead of throwing on the first blocked SOR, so one stranded
   * deal doesn't stop the rest of the batch from moving.
   */
  async bulkMoveOpportunitySnapshot(opportunityIds, targetSnapshotId, actorId) {
    const succeeded = [];
    const failed = [];
    for (const id of opportunityIds) {
      try {
        succeeded.push(await opportunityService.moveOpportunitySnapshot(id, targetSnapshotId, actorId));
      } catch (err) {
        failed.push({ id, reason: err.message });
      }
    }
    return { succeeded, failed };
  },

  /**
   * How many SORs a "Move up to vX.Y" offer would move, without moving them
   * (issue #190) — the offer states N before anyone accepts it.
   */
  async countOpportunitiesEligibleForVersionMove(targetSnapshotId) {
    const ids = await eligibleOpportunityIdsForVersionMove(targetSnapshotId);
    return ids.length;
  },

  /**
   * Moves every non-deleted SOR (Scratch included) pinned to an earlier
   * Flow Snapshot of the same major onto `targetSnapshotId`, through the
   * existing audited single-deal move (issue #190). Opt-in only — this runs
   * solely when the Operations Manager accepts the post-publish offer, never
   * as a side effect of publishing itself.
   */
  async moveOpportunitiesToVersion(targetSnapshotId, actorId) {
    const ids = await eligibleOpportunityIdsForVersionMove(targetSnapshotId);
    if (ids.length === 0) return { succeeded: [], failed: [] };
    return opportunityService.bulkMoveOpportunitySnapshot(ids, targetSnapshotId, actorId);
  },

  async deleteOpportunity(id, actorId) {
    const { data, error } = await supabase
      .from("sales_opportunities")
      .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: actorId })
      .eq("id", id)
      .select("id, client_name, sales_reference")
      .single();

    if (error) throw error;

    purchasingService
      .handleOpportunityDeleted(id, actorId, data)
      .catch(console.error);

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      id,
      `${auditLabel(data)} deleted.`,
      { event: "OPPORTUNITY_DELETED", employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * The Deleted view (issue #206): every deleted, non-scratch SOR a Super
   * Admin may see, or the subset a Deal Owner or registrar left behind.
   * `deleted_by`/`deleted_at` are null on a row deleted before this column
   * existed — the view shows "Deleted before this was recorded" rather than
   * guessing.
   */
  async getDeletedOpportunities(actorId, { isSuperAdmin = false } = {}) {
    let query = supabase
      .from("sales_opportunities")
      .select(`${PARTICIPANT_SELECT}, deleted_by_employee:employees!sales_opportunities_deleted_by_fkey(id, name, avatar_path)`)
      .eq("is_deleted", true)
      .eq("is_scratch", false)
      .order("deleted_at", { ascending: false, nullsFirst: false });

    if (!isSuperAdmin) {
      if (!actorId) return [];
      query = query.or(`deal_owner_id.eq.${actorId},registered_by.eq.${actorId}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Restores a deleted SOR — a Super Admin or its own Deal Owner. Clears the
   * flag and its deletion stamp, and never touches procurement: those
   * requests were cancelled on delete (purchasingService.handleOpportunityDeleted)
   * and restoring doesn't reopen them — whoever restores has to re-raise
   * what's still needed.
   */
  async restoreOpportunity(id, actorId) {
    const { data: existing, error: readError } = await supabase
      .from("sales_opportunities")
      .select("id, client_name, sales_reference, deal_owner_id")
      .eq("id", id)
      .single();
    if (readError) throw readError;

    const { data: actor, error: actorError } = await supabase
      .from("employees")
      .select("id, is_super_admin")
      .eq("id", actorId)
      .maybeSingle();
    if (actorError) throw actorError;

    const allowed = actor?.is_super_admin || existing.deal_owner_id === actorId;
    if (!allowed) {
      throw new Error("Only a Super Admin or this SOR's Deal Owner can restore it.");
    }

    const { data, error } = await supabase
      .from("sales_opportunities")
      .update({ is_deleted: false, deleted_at: null, deleted_by: null })
      .eq("id", id)
      .select(PARTICIPANT_SELECT)
      .single();
    if (error) throw error;

    await opportunityService.addSystemNote(
      id,
      "SOR restored from Deleted.",
      { event: "OPPORTUNITY_RESTORED", employeeId: actorId },
      actorId,
    );

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      id,
      `${auditLabel(existing)} restored.`,
      { event: "OPPORTUNITY_RESTORED", employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Permanently deletes an SOR — Super Admin only, via the security-definer
   * RPC (`sor_purge_opportunity`), which refuses unless `confirmText` matches
   * the Sales Reference (or the Company when there's none) and does the
   * actual authorization/rights check server-side. Nothing here is undoable.
   */
  async purgeOpportunity(id, confirmText, actorId) {
    const { data, error } = await supabase.rpc("sor_purge_opportunity", {
      p_id: id,
      p_confirm_text: confirmText,
    });
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "OPPORTUNITY",
      id,
      `${data.sales_reference || data.client_name} permanently deleted (${data.tasks_unlinked} task(s), ${data.committee_tasks_unlinked} committee task(s) unlinked).`,
      { event: "OPPORTUNITY_PURGED", employeeId: actorId, ...data },
      actorId,
    ).catch(console.error);

    return data;
  },

  // ── Product list / items ──────────────────────────────────────────────────

  async getItems(opportunityId) {
    if (!opportunityId) return [];
    const { data, error } = await supabase
      .from("sales_opportunity_items")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .order("sort_order", { ascending: true });

    if (error) throw error;
    return data || [];
  },

  /**
   * Full replace-set: deletes all existing rows for the opportunity and
   * inserts the given list. Items don't carry their own audit/dispute
   * significance the way the opportunity record does, so unlike notes there's
   * no need to track per-row history — this keeps the editor UI simple (no
   * id-diffing) at the cost of not preserving item-level created_at across
   * edits. A `sales_opportunities` trigger recomputes `expected_value` from
   * whatever ends up in the table after this runs.
   */
  async replaceItems(opportunityId, items) {
    const { error: delError } = await supabase
      .from("sales_opportunity_items")
      .delete()
      .eq("opportunity_id", opportunityId);
    if (delError) throw delError;

    const rows = (items || [])
      .filter((it) => (it.product_name || "").trim())
      .map((it, idx) => ({
        opportunity_id: opportunityId,
        product_name: it.product_name.trim(),
        unit: (it.unit || "").trim() || null,
        quantity: Number(it.quantity) || 0,
        unit_price: Number(it.unit_price) || 0,
        sort_order: idx,
        // Issue #202 — lines are recreated on every save, so this only
        // survives because it's written fresh each time, not because rows
        // persist. Absent on a hand-typed line.
        odoo_product_id: Number.isInteger(it.odoo_product_id) ? it.odoo_product_id : null,
      }));

    if (rows.length > 0) {
      const { error: insError } = await supabase
        .from("sales_opportunity_items")
        .insert(rows);
      if (insError) throw insError;
    }
  },

  // ── Stock availability (issue #202) ─────────────────────────────────────

  /**
   * Replaces the opportunity's stock snapshot. One row per opportunity — a
   * fetch or refresh always overwrites the previous reading, since stock is
   * never presented as live and only the latest figures matter.
   */
  async saveStockSnapshot(opportunityId, stock, actorId) {
    const { error } = await supabase.from("sor_stock_snapshots").upsert({
      opportunity_id: opportunityId,
      fetched_at: new Date().toISOString(),
      fetched_by: actorId || null,
      data: stock || {},
    });
    if (error) throw error;
  },

  async getStockSnapshot(opportunityId) {
    if (!opportunityId) return null;
    const { data, error } = await supabase
      .from("sor_stock_snapshots")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  // ── Notes / timeline ──────────────────────────────────────────────────────

  async getNotes(opportunityId) {
    if (!opportunityId) return [];
    const { data, error } = await supabase
      .from("sales_opportunity_logs")
      .select("*, author:employees!sales_opportunity_logs_author_id_fkey(id, name, avatar_path)")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  },

  /**
   * `attachments` are Cloudinary descriptors ({ url, name, type, bytes }) —
   * uploaded by the caller before the note is written, and stored on the log's
   * existing `metadata` column the same way task comments store theirs. A note
   * carrying files needs no text.
   */
  async addNote(opportunityId, authorId, content, attachments = [], mentions = []) {
    const trimmed = (content || "").trim();
    const files = (attachments || []).filter((a) => a?.url);
    if (!trimmed && files.length === 0)
      throw new Error("Add a note or attach a file.");

    // Only mentions whose name still appears in the posted text count. Picking
    // someone and then deleting the name is a change of mind, and notifying
    // them anyway would be a message about a note that never names them.
    const live = (mentions || []).filter(
      (m) => m?.id && m?.name && trimmed.includes(`@${m.name}`),
    );

    const metadata = {};
    if (files.length > 0) metadata.attachments = files;
    if (live.length > 0) metadata.mentions = live;

    // Read the "before" evidence ahead of the insert below — once that
    // insert lands, a read of this same opportunity's logs would already
    // include the file this call is about to add, and no satisfied/
    // unsatisfied transition could ever be detected.
    let attachmentsBefore = null;
    let stageCode = null;
    let flowSnapshotId = null;
    if (files.length > 0) {
      const [{ data: opportunity }, { data: priorLogs }] = await Promise.all([
        supabase
          .from("sales_opportunities")
          .select("flow_stage_id, flow_snapshot_id")
          .eq("id", opportunityId)
          .single(),
        supabase
          .from("sales_opportunity_logs")
          .select("author_id, created_at, metadata")
          .eq("opportunity_id", opportunityId),
      ]);
      stageCode = opportunity?.flow_stage_id;
      flowSnapshotId = opportunity?.flow_snapshot_id;
      attachmentsBefore = (priorLogs || []).flatMap((log) =>
        (log.metadata?.attachments || []).map((a) => ({
          ...a,
          uploadedBy: log.author_id,
          uploadedAt: log.created_at,
        })),
      );
    }

    const { data, error } = await supabase
      .from("sales_opportunity_logs")
      .insert({
        opportunity_id: opportunityId,
        author_id: authorId,
        type: "COMMENT",
        content: trimmed,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
      })
      .select("*, author:employees!sales_opportunity_logs_author_id_fkey(id, name, avatar_path)")
      .single();

    if (error) throw error;

    if (live.length > 0) {
      const { data: author } = await supabase
        .from("employees")
        .select("name")
        .eq("id", authorId)
        .single();

      const { data: opportunity } = await supabase
        .from("sales_opportunities")
        .select("sales_reference, client_name")
        .eq("id", opportunityId)
        .single();

      const label =
        opportunity?.sales_reference || opportunity?.client_name || "an opportunity";
      const snippet = trimmed.length > 90 ? `${trimmed.slice(0, 90)}…` : trimmed;

      // ADR 0021 / #295: a mention grants nothing — notifying someone
      // outside this visit's audience would be telling them about a Stage
      // Visit they cannot open. `currentVisit` is the same open visit the
      // rest of this file reads the SOR through; `null` audience means
      // there is no visit to scope by (a legacy pipeline deal), in which
      // case every live mention still gets notified as before.
      const currentVisit = await currentVisitFor(opportunityId).catch(() => null);
      const audienceIds = currentVisit?.id
        ? await this.getVisitAudienceIds(opportunityId, currentVisit.id).catch(() => null)
        : null;
      const notifiable = audienceIds ? new Set(audienceIds) : null;

      await Promise.all(
        live
          // Mentioning yourself is a way of writing, not a request for a
          // notification.
          .filter((m) => m.id !== authorId)
          .filter((m) => !notifiable || notifiable.has(m.id))
          .map((m) =>
            notificationService.createNotification({
              recipient_id: m.id,
              sender_id: authorId,
              // No "TASK" substring — notificationRouter's fallthrough would
              // send them to the task pages instead of the deal being
              // discussed. See src/utils/notificationRouter.js.
              type: "OPPORTUNITY_MENTION",
              title: "Mentioned on a deal",
              message: `${author?.name || "Someone"} mentioned you on ${label}: "${snippet}"`,
              reference_id: opportunityId,
            }),
          ),
      );
    }

    if (attachmentsBefore) {
      const attachmentsAfter = [
        ...attachmentsBefore,
        ...files.map((a) => ({ ...a, uploadedBy: data.author_id, uploadedAt: data.created_at })),
      ];

      await narrateNewlySatisfied(
        opportunityId,
        stageCode,
        flowSnapshotId,
        { attachments: attachmentsBefore },
        { attachments: attachmentsAfter },
        authorId,
      );
    }

    return data;
  },

  /** System-styled entries (stage moves, registration) attributed to the actor
   *  who triggered them, when known. Fire-and-forget: a failed note must never
   *  roll back the mutation that produced it. */
  async addSystemNote(opportunityId, content, metadata = null, authorId = null) {
    const { error } = await supabase.from("sales_opportunity_logs").insert({
      opportunity_id: opportunityId,
      author_id: authorId,
      type: "SYSTEM",
      content,
      metadata,
    });
    if (error) console.error("Failed to write opportunity system note:", error);
  },

  /**
   * Issue #204 Part 3 — Follow-up Cadence, "Log follow-up" (story 27/28).
   * Refuses when the SOR's current Stage carries no enabled cadence (its own
   * published Flow Snapshot's `snapshot_data.followUps`, never the live
   * `flow_stage_follow_ups` table — same "pinned to what was true at
   * registration" rule every other Flow Canvas setting follows), when the
   * actor is neither on the Deal Team nor resolves into the cadence's
   * recipients, or when proof is required and no attachment is given.
   *
   * A successful log writes a `FOLLOW_UP_LOGGED` timeline entry carrying the
   * open Stage Visit's id and the files, which both `nextFollowUpDue` (via
   * the SOR's own logs) and the server-side `sor_due_follow_ups` (via
   * `sales_opportunity_logs`) read as "the count restarted" (story 28).
   */
  async logFollowUp(opportunityId, { note, attachments = [] } = {}, actorId) {
    const opportunity = await opportunityService.getOpportunityById(opportunityId);
    if (!opportunity) throw new Error("That deal could not be found.");

    const stageId = currentStageId(opportunity);
    const currentVisit = await currentVisitFor(opportunityId);

    let followUps = [];
    if (opportunity.flow_snapshot_id) {
      const { data: snapshot, error } = await supabase
        .from("flow_snapshots")
        .select("snapshot_data")
        .eq("id", opportunity.flow_snapshot_id)
        .single();
      if (error) throw error;
      followUps = snapshot?.snapshot_data?.followUps || [];
    }

    const cadence = followUps.find((f) => f.id === stageId);
    if (!cadence || !cadence.enabled) {
      throw new Error("This Stage has no active Follow-up Cadence, so there is nothing to log against.");
    }

    const isDealTeam = dealTeamIds(opportunity).includes(String(actorId));
    if (!isDealTeam) {
      const recipientIds = await resolveSelectorIds(cadence.recipients, opportunity);
      if (!recipientIds.includes(String(actorId))) {
        throw new Error("Only the Deal Team or this cadence's recipients can log a follow-up.");
      }
    }

    const files = (attachments || []).filter((a) => a?.url);
    if (cadence.proofRequired !== false && files.length === 0) {
      throw new Error("This Follow-up Cadence requires at least one attachment as proof.");
    }

    await opportunityService.addSystemNote(
      opportunityId,
      note?.trim() ? `Follow-up logged: ${note.trim()}` : "Follow-up logged",
      {
        event: "FOLLOW_UP_LOGGED",
        stageVisitId: currentVisit?.id ?? null,
        stageId,
        attachments: files,
        employeeId: actorId,
      },
      actorId,
    );

    return true;
  },

  /**
   * Issue #204 Part 2 — resolves a pending "When confirmed" Stage Action
   * run: `"create"` builds exactly what the automatic path would have (via
   * the same `buildAndCreateActionTask` helper), `"skip"` creates nothing.
   * Refuses client-side too when `actorId` doesn't resolve into the run's
   * stored decider selectors — defense in depth; `sor_decide_action_run`'s
   * own check is the real gate.
   */
  async decideAction(runId, decision, actorId) {
    if (!["create", "skip"].includes(decision)) {
      throw new Error(`decideAction: invalid decision "${decision}".`);
    }

    const { data: run, error: runError } = await supabase
      .from("sor_action_runs")
      .select("*")
      .eq("id", runId)
      .single();
    if (runError) throw runError;
    if (run.outcome !== "pending") {
      throw new Error("This action has already been decided.");
    }

    const { data: existing, error: existingError } = await supabase
      .from("sales_opportunities")
      .select(PARTICIPANT_SELECT)
      .eq("id", run.opportunity_id)
      .single();
    if (existingError) throw existingError;

    const deciderIds = await resolveDeciderIds(run.decider || [], existing);
    if (!deciderIds.map(String).includes(String(actorId))) {
      throw new Error("You are not a Decider for this action.");
    }

    const { data: action, error: actionError } = await supabase
      .from("flow_stage_actions")
      .select("*")
      .eq("id", run.action_id)
      .single();
    if (actionError) throw actionError;

    const { data: stage, error: stageError } = await supabase
      .from("flow_stages")
      .select("*")
      .eq("id", run.stage_id)
      .single();
    if (stageError) throw stageError;

    const { error: decideError } = await supabase.rpc("sor_decide_action_run", {
      p_run_id: runId,
      p_decision: decision,
      p_actor_id: actorId,
    });
    if (decideError) throw decideError;

    if (decision === "skip") {
      await opportunityService.addSystemNote(
        existing.id,
        `Skipped: ${stageActionName(action)} (${stage.name}).`,
        { event: "ACTION_RUN_SKIPPED", stageId: stage.id, actionId: action.id, runId },
        actorId,
      ).catch(() => {});
      return { outcome: "skipped" };
    }

    const templateContext = {
      salesReference: existing.sales_reference,
      projectTitle: existing.project_title,
      company: existing.client_name,
      stageName: stage.name,
      dealOwnerName: existing.deal_owner_name || existing.owner_name || null,
      saleType: existing.sale_type || null,
    };
    await buildAndCreateActionTask(action, existing, stage, actorId, run, templateContext, null);
    return { outcome: "created" };
  },

  /**
   * Issue #204 Part 2 — the pending "When confirmed" runs on this SOR that
   * `actorId` may decide, with enough rendered detail for the Decider card
   * (title, what it would create, for whom). Never returns a run the actor
   * doesn't resolve into — `decideAction`/`sor_decide_action_run` refuse it
   * anyway, but a non-Decider should never see Create/Skip in the first
   * place (spec story 20).
   */
  async getPendingActionsForActor(opportunityId, actorId) {
    if (!opportunityId || !actorId) return [];

    const { data: runs, error: runsError } = await supabase
      .from("sor_action_runs")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .eq("outcome", "pending");
    if (runsError) throw runsError;
    if (!runs?.length) return [];

    const { data: existing, error: existingError } = await supabase
      .from("sales_opportunities")
      .select(PARTICIPANT_SELECT)
      .eq("id", opportunityId)
      .single();
    if (existingError) throw existingError;

    const actionIds = [...new Set(runs.map((r) => r.action_id))];
    const stageIds = [...new Set(runs.map((r) => r.stage_id))];
    const [{ data: actions, error: actionsError }, { data: stages, error: stagesError }, { data: employees, error: employeesError }] =
      await Promise.all([
        supabase.from("flow_stage_actions").select("*").in("id", actionIds),
        supabase.from("flow_stages").select("*").in("id", stageIds),
        supabase.from("employees").select("id, name"),
      ]);
    if (actionsError) throw actionsError;
    if (stagesError) throw stagesError;
    if (employeesError) throw employeesError;
    const actionById = new Map((actions || []).map((a) => [a.id, a]));
    const stageById = new Map((stages || []).map((s) => [s.id, s]));
    const employeeNameById = new Map((employees || []).map((e) => [String(e.id), e.name]));

    const results = [];
    for (const run of runs) {
      const action = actionById.get(run.action_id);
      const stage = stageById.get(run.stage_id);
      if (!action || !stage) continue;

      const deciderIds = await resolveDeciderIds(run.decider || [], existing);
      if (!deciderIds.map(String).includes(String(actorId))) continue;

      const config = action.config || {};
      const templateContext = {
        salesReference: existing.sales_reference,
        projectTitle: existing.project_title,
        company: existing.client_name,
        stageName: stage.name,
        dealOwnerName: existing.deal_owner_name || existing.owner_name || null,
        saleType: existing.sale_type || null,
      };

      // Structured, not a pre-built sentence — spec: the card shows "what it
      // would create and for whom" (story 14), so the actual assignee(s) the
      // real builder would use, not a placeholder or a bare count.
      // `PendingActionDecisions.jsx` turns this into a sentence.
      const target =
        action.kind === "create_group_task"
          ? {
              kind: "group",
              members: (config.members || []).map((m) => ({
                id: m.employeeId,
                name: employeeNameById.get(String(m.employeeId)) || "Former employee",
              })),
            }
          : {
              kind: "individual",
              // No configured assignee means the builder falls back to
              // whichever Decider clicks Create (`loggedById: config.loggedById
              // || actorId` in buildAndCreateActionTask) — genuinely "you",
              // not a stand-in for missing data.
              assignee: config.loggedById
                ? { id: config.loggedById, name: employeeNameById.get(String(config.loggedById)) || "Former employee" }
                : null,
            };

      results.push({
        runId: run.id,
        actionId: action.id,
        stageName: stage.name,
        title: renderActionTitle(action, templateContext),
        target,
      });
    }

    return results;
  },

  // ── SOR Members ────────────────────────────────────────────────────────────

  /** Everyone added to this deal (docs/crm-pipeline-redesign.md's SOR Member), oldest first. */
  async getMembers(opportunityId) {
    if (!opportunityId) return [];
    const { data, error } = await supabase
      .from("sales_opportunity_members")
      .select(
        "*, employee:employees!sales_opportunity_members_employee_id_fkey(id, name, avatar_path, department, sub_department)",
      )
      .eq("opportunity_id", opportunityId)
      .order("added_at", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  /**
   * Adds someone as an SOR Member — additive and permanent (the glossary's
   * own words): there is no remove path, and re-adding an existing member is
   * a safe no-op rather than a duplicate row or an error, enforced by
   * `sales_opportunity_members_unique` (0044).
   *
   * This is "the existing assignment flow" ticket 5's `assignment` kind
   * satisfies itself through — assigning a purchasing officer at Proposal
   * Submitted is exactly this call.
   */
  async addMember(opportunityId, employeeId, actorId, { conditionId = null } = {}) {
    if (!employeeId) throw new Error("Choose someone to add.");

    const existingMembers = await opportunityService.getMembers(opportunityId);
    const already = existingMembers.find((m) => m.employee_id === employeeId);
    if (already) return already;

    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("id, name, department, sub_department")
      .eq("id", employeeId)
      .single();
    if (employeeError) throw employeeError;

    const { data: opportunity, error: opportunityError } = await supabase
      .from("sales_opportunities")
      .select("status, flow_stage_id, flow_snapshot_id")
      .eq("id", opportunityId)
      .single();
    if (opportunityError) throw opportunityError;

    // Issue #294: an Assignment condition is a call-in — the person added
    // through it becomes a Stage Participant, windowed by the condition's
    // own `config.access`.
    if (conditionId) {
      const currentVisitId = await opportunityService.getCurrentStageVisitId(opportunityId);
      if (currentVisitId) {
        const { data: condition } = await supabase
          .from("stage_conditions")
          .select("config")
          .eq("id", conditionId)
          .maybeSingle();
        await sorStageParticipantService.openWindow(
          {
            opportunityId,
            employeeId,
            source: "assignment",
            sourceId: conditionId,
            openedVisitId: currentVisitId,
            access: condition?.config?.access,
          },
          actorId,
        ).catch((err) => console.error("openWindow failed for assignment condition:", err));
      }
    }

    const { data, error } = await supabase
      .from("sales_opportunity_members")
      .insert({ opportunity_id: opportunityId, employee_id: employeeId, added_by: actorId })
      .select(
        "*, employee:employees!sales_opportunity_members_employee_id_fkey(id, name, avatar_path, department, sub_department)",
      )
      .single();
    if (error) throw error;

    await opportunityService.addSystemNote(
      opportunityId,
      `${employee.name} added as a member of this deal.`,
      { event: "SOR_MEMBER_ADDED", memberEmployeeId: employee.id, employeeId: actorId },
      actorId,
    );

    const groupsByEmployee = groupIdsByEmployee(await employeeGroupService.list());
    await narrateNewlySatisfied(
      opportunityId,
      opportunity.flow_stage_id || opportunity.status,
      opportunity.flow_snapshot_id,
      { members: membersForGate(existingMembers, groupsByEmployee) },
      { members: membersForGate([...existingMembers, data], groupsByEmployee) },
      actorId,
    );

    return data;
  },

  // ── Stage conditions — tickbox satisfaction ───────────────────────────────

  /**
   * Ticks a `tickbox` condition for this deal. The one kind with no other
   * evidence (docs/stage-gate-engine-spec.md), so the status row IS the
   * certification — unlike attachment/field/assignment, there is no live
   * record to evaluate, only this direct action. Idempotent: a condition
   * once satisfied stays satisfied (D31), so ticking it again is a no-op
   * that returns the original row rather than overwriting who satisfied it.
   */
  async satisfyCondition(opportunityId, conditionId, actorId) {
    const { data: opp, error: oppError } = await supabase
      .from("sales_opportunities")
      .select("flow_snapshot_id")
      .eq("id", opportunityId)
      .single();
    if (oppError) throw oppError;

    let condition;
    if (opp.flow_snapshot_id) {
      const { data: snapshot } = await supabase
        .from("flow_snapshots")
        .select("snapshot_data")
        .eq("id", opp.flow_snapshot_id)
        .single();
      const allConditions = snapshot?.snapshot_data?.conditions || [];
      condition = allConditions.find(c => c.id === conditionId);
      if (!condition) {
        throw new Error("This condition has been archived and no longer applies.");
      }
    } else {
      const { data: liveCondition, error: conditionError } = await supabase
        .from("stage_conditions")
        .select("*")
        .eq("id", conditionId)
        .single();
      if (conditionError) throw conditionError;
      if (liveCondition.archived_at) {
        throw new Error("This condition has been archived and no longer applies.");
      }
      condition = liveCondition;
    }

    if (condition.kind !== CONDITION_KINDS.TICKBOX) {
      throw new Error("Only a tickbox condition can be satisfied this way.");
    }

    // Issue #203, story 28: certification is scoped to the currently-open
    // visit, so a tick from a visit that has since closed (a loop back) no
    // longer counts and this insert is not blocked by it either.
    const currentVisit = await currentVisitFor(opportunityId);

    let satisfiedQuery = supabase
      .from("sor_condition_status")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .eq("condition_id", conditionId);
    if (currentVisit?.id) satisfiedQuery = satisfiedQuery.eq("stage_visit_id", currentVisit.id);
    const { data: satisfied, error: satisfiedError } = await satisfiedQuery.maybeSingle();
    if (satisfiedError) throw satisfiedError;
    if (satisfied) return satisfied;

    const { data, error } = await supabase
      .from("sor_condition_status")
      .insert({
        opportunity_id: opportunityId,
        condition_id: conditionId,
        satisfied_by: actorId,
        stage_visit_id: currentVisit?.id ?? null,
      })
      .select()
      .single();
    if (error) throw error;

    await noteConditionSatisfied(opportunityId, condition, actorId);

    return data;
  },

  /**
   * The id of the SOR's currently-open Stage Visit, or null for a legacy
   * pipeline deal. Exposed for the UI (issue #203, stories 12/28): a
   * condition-row attachment upload stamps this into the file's metadata
   * alongside `conditionId`, so evidence given now is never read back as
   * satisfying a future loop back to the same Stage.
   */
  async getCurrentStageVisitId(opportunityId) {
    const visit = await currentVisitFor(opportunityId);
    return visit?.id ?? null;
  },

  /**
   * ADR 0021 / #295: employee ids who may see `visitId` right now, per
   * `sor_visit_audience`. The SOR chat's mention roster and its
   * mention-notification routing both read through this — nothing else
   * decides who belongs in either. Returns `null` (not an empty list) when
   * there is no visit to scope by, so a legacy pipeline deal with no Stage
   * Visits is left unrestricted rather than restricted to nobody.
   */
  async getVisitAudienceIds(opportunityId, visitId) {
    if (!opportunityId || !visitId) return null;
    const { data, error } = await supabase.rpc("sor_visit_audience", {
      p_opportunity_id: opportunityId,
      p_visit_id: visitId,
    });
    if (error) throw error;
    return (data || []).map((row) => (typeof row === "string" ? row : row.sor_visit_audience));
  },

  /**
   * The current Stage Visit's window, shaped the way `visitOwnsTask` reads a
   * visit — the Now tab scopes its task rows with it (#299), by the same rule
   * the Journey uses. Null for a pipeline deal, which never opens one.
   */
  async getCurrentStageVisit(opportunityId) {
    const visit = await currentVisitFor(opportunityId);
    if (!visit) return null;
    return { id: visit.id, enteredAt: visit.entered_at, leftAt: visit.left_at };
  },

  /**
   * Issue #204 Part 3 — the SOR view's "Next reminder …" line: the current
   * Stage's cadence (from the SOR's own Flow Snapshot, never the live
   * `flow_stage_follow_ups` table), plus when the next reminder is due per
   * `nextFollowUpDue`, computed from the same timeline entries
   * `sor_due_follow_ups` reads server-side. Null when the Stage carries no
   * enabled cadence.
   */
  async getFollowUpStatus(opportunityId) {
    const opportunity = await opportunityService.getOpportunityById(opportunityId);
    if (!opportunity?.flow_snapshot_id) return null;

    const stageId = currentStageId(opportunity);
    const { data: snapshot, error } = await supabase
      .from("flow_snapshots")
      .select("snapshot_data")
      .eq("id", opportunity.flow_snapshot_id)
      .single();
    if (error) throw error;

    const cadence = (snapshot?.snapshot_data?.followUps || []).find((f) => f.id === stageId);
    if (!cadence || !cadence.enabled) return null;

    const [visit, logs] = await Promise.all([
      currentVisitFor(opportunityId),
      supabase
        .from("sales_opportunity_logs")
        .select("created_at, metadata")
        .eq("opportunity_id", opportunityId),
    ]);
    if (logs.error) throw logs.error;

    const forThisVisit = (event) =>
      (logs.data || [])
        .filter((l) => l.metadata?.event === event && l.metadata?.stageVisitId === visit?.id)
        .map((l) => l.created_at)
        .sort()
        .pop() || null;

    const nextDue = nextFollowUpDue({
      enteredAt: visit?.entered_at,
      lastLoggedAt: forThisVisit("FOLLOW_UP_LOGGED"),
      lastReminderAt: forThisVisit("FOLLOW_UP_REMINDER"),
      everyDays: cadence.everyDays,
      leftAt: visit?.left_at,
    });

    return { cadence, nextDue, stageVisitId: visit?.id ?? null };
  },

  /**
   * The id of the closed Stage Visit immediately before the SOR's current
   * one on the same Stage, or null on a first visit. Issue #203, story 26:
   * a custom Stage Field renders blank on a loop back, with the previous
   * visit's value shown only for reference — this is how the UI finds that
   * prior visit's id to read its `sor_stage_field_values` through
   * `stageFieldService.getValuesForVisit`.
   */
  async getPreviousStageVisitId(opportunityId, flowStageId) {
    if (!opportunityId || !flowStageId) return null;
    const { data, error } = await supabase
      .from("sor_stage_visits")
      .select("id")
      .eq("opportunity_id", opportunityId)
      .eq("flow_stage_id", flowStageId)
      .not("left_at", "is", null)
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  },

  // ── Deal Owner visibility (ticket 6) ────────────────────────────────────────

  /**
   * What the deal's current Stage owes, right now — every one of its live
   * (non-archived, non-`deadline`) conditions alongside `evaluateCondition`'s
   * verdict, so a Deal Owner can see the whole list before trying to move
   * instead of being refused one item at a time. Deadline conditions never
   * block and have their own display surface (ticket 7), so they're left out.
   *
   * `opportunity` can be passed in when the caller already has it (the
   * details modal always does) to skip a redundant read.
   */
  async getStageChecklist(opportunityId, opportunity = null) {
    const target = opportunity || (await opportunityService.getOpportunityById(opportunityId));
    if (!target) return [];
    const stageCode = target.flow_stage_id || target.status;

    let conditions = [];
    if (target.flow_snapshot_id) {
      const { data: snapshot } = await supabase
        .from("flow_snapshots")
        .select("snapshot_data")
        .eq("id", target.flow_snapshot_id)
        .single();
      
      conditions = conditionsForSnapshotStage(snapshot?.snapshot_data?.conditions || [], stageCode)
        .filter((r) => r.kind !== CONDITION_KINDS.DEADLINE);
    } else {
      const { data: liveConditions } = await supabase
        .from("stage_conditions")
        .select("*")
        .eq("stage_id", stageCode)
        .is("archived_at", null)
        .neq("kind", CONDITION_KINDS.DEADLINE);
      
      conditions = liveConditions || [];
    }

    const currentVisit = await currentVisitFor(opportunityId);
    const { attachments, members, statusRowsByCondition } = await gateEvidenceFor(
      opportunityId,
      conditions,
      { stageVisitId: currentVisit?.id },
    );

    conditions.sort((a, b) => a.sort_order - b.sort_order);

    const hasInclusions = await resolveHasInclusions(conditions, target.id);
    const hasPurchasing = await resolveHasPurchasing(conditions, target.id);

    return conditions
      .map((condition) => ({
        condition,
        ...evaluateCondition(condition, {
          opportunity: target,
          attachments,
          members,
          statusRow: statusRowsByCondition[condition.id] ?? null,
          hasInclusions,
          hasPurchasing,
        }),
      }))
      // Issue #203: a removed kind (field, project_evaluation) always reads
      // not_applicable — leave it off the checklist entirely rather than
      // show a row nothing can ever satisfy.
      .filter((row) => row.status !== CONDITION_STATUS.NOT_APPLICABLE);
  },

  /**
   * A Sales Director's register-level read (story 25): every one of the
   * given deals that is blocked on its own current Stage, and what it's
   * missing. One bulk read instead of one checklist call per row — `opportunities`
   * is whatever the register already has loaded, not re-fetched here.
   *
   * Returns `{ [opportunityId]: condition[] }`, present only for a deal
   * that actually has something outstanding.
   */
  async getBlockedDeals(opportunities = []) {
    if (opportunities.length === 0) return {};

    // Stage Conditions only ever exist on a Sales Flow Stage (stage_conditions.
    // stage_id is a uuid FK into flow_stages, never a legacy pipeline code) —
    // a legacy deal running the global pipeline, no Sale Type, has no Stage
    // Conditions to be blocked by, full stop. Querying stage_conditions with
    // legacy stage codes like "LEAD" instead of a uuid used to throw outright
    // (22P02, invalid uuid syntax) the moment any legacy deal was in view.
    const flowBuilt = opportunities.filter((o) => o.flow_snapshot_id);

    const snapshotIds = [...new Set(flowBuilt.map((o) => o.flow_snapshot_id))];
    let snapshotConditions = [];
    let snapshotsById = {};
    if (snapshotIds.length > 0) {
      const { data: snapshots } = await supabase
        .from("flow_snapshots")
        .select("id, snapshot_data")
        .in("id", snapshotIds);

      for (const snap of snapshots || []) {
        snapshotsById[snap.id] = snap;
        const conds = (snap.snapshot_data?.conditions || []).filter(
          (c) => c.is_required && c.kind !== CONDITION_KINDS.DEADLINE,
        );
        snapshotConditions.push(...conds);
      }
    }

    // Deduplicate conditions by id, since multiple deals on the same snapshot
    // might have added the same condition objects to the list.
    const uniqueConditions = Array.from(new Map(snapshotConditions.map((c) => [c.id, c])).values());

    if (uniqueConditions.length === 0) return {};

    const opportunityIds = opportunities.map((o) => o.id);
    const conditionIds = uniqueConditions.map((r) => r.id);

    const [
      { data: statusRows, error: statusError },
      { data: logs, error: logsError },
      { data: memberRows, error: memberError },
      groups,
    ] = await Promise.all([
      supabase
        .from("sor_condition_status")
        .select("*")
        .in("opportunity_id", opportunityIds)
        .in("condition_id", conditionIds),
      supabase
        .from("sales_opportunity_logs")
        .select("opportunity_id, author_id, created_at, metadata")
        .in("opportunity_id", opportunityIds),
      supabase
        .from("sales_opportunity_members")
        .select(
          "opportunity_id, employee_id, added_at, employee:employees!sales_opportunity_members_employee_id_fkey(department, sub_department)",
        )
        .in("opportunity_id", opportunityIds),
      employeeGroupService.list(),
    ]);
    if (statusError) throw statusError;
    if (logsError) throw logsError;
    if (memberError) throw memberError;

    const attachmentsByOpportunity = {};
    for (const log of logs || []) {
      const attachments = attachmentsFromLog(log);
      if (attachments.length === 0) continue;
      (attachmentsByOpportunity[log.opportunity_id] ??= []).push(...attachments);
    }

    const groupsByEmployee = groupIdsByEmployee(groups);
    const membersByOpportunity = groupBy(memberRows, "opportunity_id");
    for (const opportunityId of Object.keys(membersByOpportunity)) {
      membersByOpportunity[opportunityId] = membersForGate(membersByOpportunity[opportunityId], groupsByEmployee);
    }

    const statusByOpportunity = {};
    for (const row of statusRows || []) {
      (statusByOpportunity[row.opportunity_id] ??= {})[row.condition_id] = row;
    }

    const blocked = {};
    for (const opportunity of opportunities) {
      let stageConditions = [];
      if (opportunity.flow_snapshot_id) {
        const snap = snapshotsById[opportunity.flow_snapshot_id];
        stageConditions = conditionsForSnapshotStage(
          snap?.snapshot_data?.conditions || [],
          currentStageId(opportunity),
        ).filter((c) => c.is_required && c.kind !== CONDITION_KINDS.DEADLINE);
      }
      // A legacy deal (no flow_snapshot_id) has no Stage Conditions —
      // stageConditions stays [] and it's skipped below.

      if (stageConditions.length === 0) continue;

      const [hasInclusions, hasPurchasing] = await Promise.all([
        resolveHasInclusions(stageConditions, opportunity.id),
        resolveHasPurchasing(stageConditions, opportunity.id),
      ]);

      const missing = stageConditions.filter(
        (condition) =>
          evaluateCondition(condition, {
            opportunity,
            attachments: attachmentsByOpportunity[opportunity.id] || [],
            members: membersByOpportunity[opportunity.id] || [],
            statusRow: (statusByOpportunity[opportunity.id] || {})[condition.id] ?? null,
            hasInclusions,
            hasPurchasing,
          }).status === CONDITION_STATUS.UNSATISFIED,
      );
      if (missing.length > 0) blocked[opportunity.id] = missing;
    }

    return blocked;
  },

  // ── Deadline kind — countdown + notifications (ticket 7) ────────────────────

  /**
   * The board card countdown, and the register's "past a deadline" read
   * (story 26): the most urgent active `deadline` condition on each
   * opportunity's own current Stage, evaluated against "now". Absent for an
   * opportunity whose Stage carries no live `deadline` condition.
   */
  async getDeadlineStatuses(opportunities = []) {
    const evaluations = await deadlineEvaluations(opportunities);
    const result = {};
    for (const [opportunityId, items] of Object.entries(evaluations)) {
      // Most urgent first — a card/badge shows one clock, not a list, so a
      // Stage that (unusually) carries two deadlines leads with whichever is
      // closer to breaching.
      result[opportunityId] = [...items].sort((a, b) => a.daysRemaining - b.daysRemaining)[0];
    }
    return result;
  },

  /**
   * D42 — fires the approach/breach notification (story 17) through the
   * existing notification service. Never a gate (D42, story 18): this only
   * ever narrates and notifies, it cannot block a move.
   *
   * There's no server-side cron in this app to trigger this on a schedule,
   * so it's called client-side, opportunistically, wherever open deals are
   * already loaded (the Opportunities register on page load). That's safe to
   * do repeatedly because it's idempotent per milestone: a
   * `STAGE_DEADLINE_APPROACHING`/`STAGE_DEADLINE_BREACHED` note on the
   * opportunity's own timeline both tells the story (D42's "through the
   * existing notification service" pairs naturally with this app's
   * everything-narrates-to-the-timeline convention) and doubles as the dedup
   * marker, so calling this on every page load never re-notifies the same
   * milestone twice.
   */
  async checkDeadlineNotifications(opportunities = []) {
    const evaluations = await deadlineEvaluations(opportunities);
    if (Object.keys(evaluations).length === 0) return [];

    const opportunityById = new Map(opportunities.map((o) => [o.id, o]));
    const notified = [];

    for (const [opportunityId, items] of Object.entries(evaluations)) {
      const opportunity = opportunityById.get(opportunityId);
      if (!opportunity?.deal_owner_id) continue; // nobody to tell

      for (const { condition, daysRemaining, isBreached, isApproaching } of items) {
        const milestone = isBreached ? "BREACHED" : isApproaching ? "APPROACHING" : null;
        if (!milestone) continue;

        const event = `STAGE_DEADLINE_${milestone}`;
        const { data: existing, error: existingError } = await supabase
          .from("sales_opportunity_logs")
          .select("id")
          .eq("opportunity_id", opportunityId)
          .eq("metadata->>event", event)
          .eq("metadata->>conditionId", condition.id)
          .limit(1);
        if (existingError) throw existingError;
        if (existing && existing.length > 0) continue;

        const stageLabel = STAGE_LABELS[opportunity.status] || opportunity.status;
        const { title, describe } = DEADLINE_MILESTONES[milestone];
        const content = describe(condition.label, stageLabel, daysRemaining);

        // No actorId — nobody did anything to cause this, time simply
        // passed, so there's no human to attribute it to (addSystemNote
        // defaults author_id to null for exactly this case).
        await opportunityService.addSystemNote(opportunityId, content, {
          event,
          conditionId: condition.id,
          label: condition.label,
          daysRemaining,
        });

        await notificationService.createNotification({
          recipient_id: opportunity.deal_owner_id,
          type: `OPPORTUNITY_DEADLINE_${milestone}`,
          title,
          message: content,
          reference_id: opportunityId,
        });

        notified.push({ opportunityId, conditionId: condition.id, milestone });
      }
    }

    return notified;
  },

  async getAutomationTasks(opportunityId) {
    const [tasksRes, committeeTasksRes] = await Promise.all([
      supabase.from("tasks").select(SOR_TASK_COLUMNS).eq("opportunity_id", opportunityId),
      supabase.from("committee_tasks").select(SOR_GROUP_TASK_COLUMNS).eq("opportunity_id", opportunityId),
    ]);

    if (tasksRes.error) throw tasksRes.error;
    if (committeeTasksRes.error) throw committeeTasksRes.error;

    return {
      individualTasks: tasksRes.data || [],
      groupTasks: committeeTasksRes.data || [],
    };
  },

  /**
   * The Journey tab's whole read (#300, stories 10-13): every Stage Visit
   * this SOR has made, latest first, each carrying what stood on it — the
   * Stage's name and bracket, who moved the SOR in and out, that visit's own
   * condition evidence, the tasks raised while it was open, and the items
   * requested on it.
   *
   * Everything per-visit is scoped to the visit, not to the SOR, because
   * that scoping is the tab's entire point: a Stage the SOR looped through
   * twice gets two rows, and a tickbox certified on the first does not make
   * the second read as done (issue #203, story 28). Evidence therefore goes
   * through the same `gateEvidenceFor`/`evaluateCondition` pair the live
   * checklist uses, once per visit, rather than a second opinion about what
   * "satisfied" means.
   */
  async getJourney(opportunityId) {
    if (!opportunityId) return [];

    const [{ data: opportunity, error: opportunityError }, { data: visitRows, error: visitsError }] =
      await Promise.all([
        // Only the Snapshot pointer is wanted, and only as a fallback for a
        // visit that carries none — `getOpportunityById` would drag five
        // employee joins along for one column.
        supabase.from("sales_opportunities").select("id, flow_snapshot_id").eq("id", opportunityId).maybeSingle(),
        supabase
          .from("sor_stage_visits")
          .select(`
            *,
            enteredBy:employees!sor_stage_visits_entered_by_fkey(id, name, avatar_path),
            leftBy:employees!sor_stage_visits_left_by_fkey(id, name, avatar_path)
          `)
          .eq("opportunity_id", opportunityId)
          .order("sequence", { ascending: false }),
      ]);
    if (opportunityError) throw opportunityError;
    if (visitsError) throw visitsError;

    const visits = visitRows || [];
    if (visits.length === 0) return [];

    const snapshotIdFor = (visit) => visit.flow_snapshot_id || opportunity?.flow_snapshot_id || null;
    const snapshotIds = [...new Set(visits.map(snapshotIdFor).filter(Boolean))];
    const stageIds = [...new Set(visits.map((v) => v.flow_stage_id).filter(Boolean))];

    const [snapshotsRes, stagesRes, tasksRes, groupTasksRes] = await Promise.all([
      snapshotIds.length > 0
        ? supabase.from("flow_snapshots").select("id, snapshot_data").in("id", snapshotIds)
        : Promise.resolve({ data: [] }),
      stageIds.length > 0
        ? supabase.from("flow_stages").select("id, name, bracket_label").in("id", stageIds)
        : Promise.resolve({ data: [] }),
      supabase.from("tasks").select(SOR_TASK_COLUMNS).eq("opportunity_id", opportunityId),
      supabase.from("committee_tasks").select(SOR_GROUP_TASK_COLUMNS).eq("opportunity_id", opportunityId),
    ]);
    if (snapshotsRes.error) throw snapshotsRes.error;
    if (stagesRes.error) throw stagesRes.error;
    if (tasksRes.error) throw tasksRes.error;
    if (groupTasksRes.error) throw groupTasksRes.error;

    const snapshotsById = Object.fromEntries((snapshotsRes.data || []).map((s) => [s.id, s]));
    const liveStagesById = Object.fromEntries((stagesRes.data || []).map((s) => [s.id, s]));

    // The SOR's own Snapshot names the Stage, never the live row (issue #83):
    // a Stage renamed or moved to another bracket since must not rewrite what
    // a closed visit was. The live row is the fallback for a visit backfilled
    // from before Snapshots, which points at no snapshot of its own.
    const stageFor = (visit) => {
      const frozen = snapshotRows(snapshotsById[snapshotIdFor(visit)]?.snapshot_data?.stages).find(
        (s) => s.id === visit.flow_stage_id,
      );
      const stage = frozen || liveStagesById[visit.flow_stage_id] || null;
      return {
        id: visit.flow_stage_id,
        name: stage?.name || "Unknown stage",
        bracket: stage?.bracket_label || null,
      };
    };

    const tasks = tasksRes.data || [];
    const groupTasks = groupTasksRes.data || [];

    const shaped = visits.map((visit) => {
      const visitWindow = { id: visit.id, enteredAt: visit.entered_at, leftAt: visit.left_at };
      return {
        ...visitWindow,
        sequence: visit.sequence,
        stage: stageFor(visit),
        flowSnapshotId: snapshotIdFor(visit),
        enteredBy: visit.enteredBy || null,
        leftBy: visit.leftBy || null,
        tasks: tasks.filter((task) => visitOwnsTask(task, visitWindow)),
        groupTasks: groupTasks.filter((task) => visitOwnsTask(task, visitWindow)),
        // #209 fills this in with the visit's Purchase Requests; until it does,
        // the slot exists so the tab renders the same shape either way.
        requestedItems: [],
      };
    });

    const withConditions = await Promise.all(
      shaped.map(async (visit) => {
        const conditions = conditionsForSnapshotStage(
          snapshotsById[visit.flowSnapshotId]?.snapshot_data?.conditions || [],
          visit.stage.id,
        )
          // Same exclusion as `getStageChecklist`: a Deadline is tracked
          // through its own milestone events, never as a checklist row, so
          // it is not a visit's condition list either.
          .filter((c) => c.kind !== CONDITION_KINDS.DEADLINE)
          .sort((a, b) => a.sort_order - b.sort_order);
        if (conditions.length === 0) return { ...visit, conditions: [] };

        const [{ attachments, members, statusRowsByCondition }, hasInclusions, hasPurchasing] = await Promise.all([
          gateEvidenceFor(opportunityId, conditions, { stageVisitId: visit.id, asOf: visit.leftAt }),
          resolveHasInclusions(conditions, opportunityId, { asOf: visit.leftAt }),
          resolveHasPurchasing(conditions, opportunityId, { asOf: visit.leftAt }),
        ]);

        return {
          ...visit,
          conditions: conditions
            .map((condition) => ({
              condition,
              ...evaluateCondition(condition, {
                opportunity,
                attachments,
                members,
                statusRow: statusRowsByCondition[condition.id] ?? null,
                hasInclusions,
                hasPurchasing,
              }),
            }))
            // Same rule as `getStageChecklist`: a removed kind can never be
            // satisfied, so it is not a row anyone can act on or read.
            .filter((row) => row.status !== CONDITION_STATUS.NOT_APPLICABLE),
        };
      }),
    );

    // Evidence names its actor by id; the tab shows a face beside "met by",
    // so they are resolved once here rather than a lookup per rendered row.
    const satisfierIds = [
      ...new Set(withConditions.flatMap((v) => v.conditions.map((c) => c.satisfiedBy)).filter(Boolean)),
    ];
    let peopleById = {};
    if (satisfierIds.length > 0) {
      const { data: people, error } = await supabase
        .from("employees")
        .select("id, name, avatar_path")
        .in("id", satisfierIds);
      if (error) throw error;
      peopleById = Object.fromEntries((people || []).map((p) => [p.id, p]));
    }

    return withConditions.map((visit) => ({
      ...visit,
      conditions: visit.conditions.map((row) => ({
        ...row,
        satisfiedBy: row.satisfiedBy ? (peopleById[row.satisfiedBy] ?? null) : null,
      })),
    }));
  },
};
