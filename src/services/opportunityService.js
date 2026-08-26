import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";
import { procurementService } from "./procurementService";
import { notificationService } from "./notificationService";
import { pipelineStageService } from "./pipelineStageService";
import { getCurrentLocalDate } from "../utils/formatDate";
import { deriveProjectType } from "../utils/commission";
import {
  STAGE_LABELS,
  formatPHP,
  isAnchorCode,
  isLostCode,
  isValidSalesReference,
  itbGateSatisfiedBy,
  normalizeSalesReference,
  requiresItbNumber,
  requiresSalesReference,
  SALES_REFERENCE_HINT,
} from "../constants/sor";
import {
  deadlineStatus,
  evaluateCrossing,
  evaluateRequirement,
  REQUIREMENT_KINDS,
  REQUIREMENT_STATUS,
  stagesCrossed,
} from "../constants/stageGate";

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

/** The narration a requirement's satisfaction writes, however it got satisfied. */
async function noteRequirementSatisfied(opportunityId, requirement, actorId) {
  await opportunityService.addSystemNote(
    opportunityId,
    `Requirement satisfied: "${requirement.label}".`,
    { event: "STAGE_REQUIREMENT_SATISFIED", requirementId: requirement.id, label: requirement.label, employeeId: actorId },
    actorId,
  );
}

/**
 * Turns `sales_opportunity_members` rows into the `{ employeeId, department,
 * assignedAt }` shape `evaluateRequirement`'s `assignment` kind expects
 * (constants/stageGate.js). An `assignment` requirement's config names one
 * department string (e.g. "Purchasing" or "OPERATIONS") without saying which
 * level of `employees.department`/`sub_department` it means, so each member
 * contributes one entry per level they actually have — a lookup against
 * either matches.
 */
function membersForGate(rows = []) {
  const entries = [];
  for (const row of rows) {
    const department = row.employee?.department;
    const subDepartment = row.employee?.sub_department;
    if (department) {
      entries.push({ employeeId: row.employee_id, department, assignedAt: row.added_at });
    }
    if (subDepartment) {
      entries.push({ employeeId: row.employee_id, department: subDepartment, assignedAt: row.added_at });
    }
  }
  return entries;
}

/**
 * Stage Gate Engine, ticket 5 (.scratch/stage-gate-engine/issues/05-per-kind-
 * satisfaction.md) — narrates a Stage's live-evaluated requirements
 * (attachment/field/assignment) that flip from unsatisfied to satisfied as a
 * result of one action, the way a stage move already narrates itself.
 * `tickbox` isn't included: it has no "before/after" to diff, since ticking
 * it IS the satisfying action (see satisfyRequirement, below).
 *
 * Scoped to `stageCode`'s own requirements — the deal's current Stage, the
 * one whose gate is actually still open. A Stage already left had every
 * required item satisfied already (or the move would have been refused), so
 * there is nothing there left to newly satisfy.
 */
async function narrateNewlySatisfied(opportunityId, stageCode, before, after, actorId) {
  const { data: requirements, error } = await supabase
    .from("stage_requirements")
    .select("*")
    .eq("stage_code", stageCode)
    .is("archived_at", null)
    .in("kind", [REQUIREMENT_KINDS.ATTACHMENT, REQUIREMENT_KINDS.FIELD, REQUIREMENT_KINDS.ASSIGNMENT]);
  if (error) throw error;
  if (!requirements || requirements.length === 0) return;

  for (const requirement of requirements) {
    const wasSatisfied =
      evaluateRequirement(requirement, before).status === REQUIREMENT_STATUS.SATISFIED;
    const isSatisfied =
      evaluateRequirement(requirement, after).status === REQUIREMENT_STATUS.SATISFIED;

    if (!wasSatisfied && isSatisfied) {
      await noteRequirementSatisfied(opportunityId, requirement, actorId);
    }
  }
}

/**
 * A `sales_opportunity_logs` row's `metadata.attachments`, shaped into the
 * `{ ...file, uploadedBy, uploadedAt }` evidence `evaluateRequirement`'s
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
 * Live (non-archived) `stage_requirements` for a set of Stage codes, grouped
 * by Stage — the read every batch caller below starts from, before asking
 * "what does THIS deal's own Stage carry". `narrow` lets a caller add its
 * own filter (e.g. `getBlockedDeals`' is_required/kind) on top of the
 * archived_at check every caller needs regardless.
 */
async function requirementsByStageFor(stageCodes, narrow = (query) => query) {
  const { data: requirements, error } = await narrow(
    supabase.from("stage_requirements").select("*").in("stage_code", stageCodes).is("archived_at", null),
  );
  if (error) throw error;
  return { requirements: requirements || [], requirementsByStage: groupBy(requirements, "stage_code") };
}

/**
 * Everything `evaluateRequirement`/`evaluateCrossing` need to judge the
 * requirements configured on `stageCodes`, for one opportunity: the
 * requirements themselves (grouped by Stage), the attachment evidence, the
 * SOR Members, and any `sor_requirement_status` rows. Shared by the live
 * gate check (ticket 2) and the read-only checklist (ticket 6) so both agree
 * on what "satisfied" means from a single place, rather than each doing its
 * own fetch-and-shape.
 */
async function gateContext(opportunityId, stageCodes) {
  const { requirements, requirementsByStage } = await requirementsByStageFor(stageCodes);
  if (requirements.length === 0) {
    return { requirementsByStage, attachments: [], members: [], statusRowsByRequirement: {} };
  }

  const requirementIds = requirements.map((r) => r.id);
  const [{ data: statusRows, error: statusError }, { data: logs, error: logsError }, memberRows] =
    await Promise.all([
      supabase
        .from("sor_requirement_status")
        .select("*")
        .eq("opportunity_id", opportunityId)
        .in("requirement_id", requirementIds),
      supabase
        .from("sales_opportunity_logs")
        .select("author_id, created_at, metadata")
        .eq("opportunity_id", opportunityId),
      opportunityService.getMembers(opportunityId),
    ]);
  if (statusError) throw statusError;
  if (logsError) throw logsError;

  const attachments = (logs || []).flatMap(attachmentsFromLog);

  const statusRowsByRequirement = {};
  for (const row of statusRows || []) {
    statusRowsByRequirement[row.requirement_id] = row;
  }

  return { requirementsByStage, attachments, members: membersForGate(memberRows), statusRowsByRequirement };
}

/**
 * Stage Gate Engine (docs/stage-gate-engine-spec.md, ticket 2 of
 * .scratch/stage-gate-engine/issues/) — throws if any required requirement
 * on any Stage the move crosses is unsatisfied, naming what's missing.
 * Coexists with the ITB gate in `updateStatus`; either can block the same
 * move, independently, on unrelated things.
 *
 * Evaluates every Stage in `[from, to)`, not just the destination, so a
 * multi-Stage jump can't skip past a requirement it never satisfied.
 * `opportunityAfterMove` should be `{ ...existing, ...patch }` — the same
 * "as it will be after this move" rule the ITB check applies to itself — so
 * a `field` requirement on a column this same call is about to set (e.g.
 * Sales Reference) sees the incoming value, not the one it's replacing.
 */
async function assertStageGateSatisfied(opportunityId, fromCode, toCode, opportunityAfterMove) {
  const stages = await pipelineStageService.getAllStages();
  const crossed = stagesCrossed(fromCode, toCode, stages);
  if (crossed.length === 0) return;

  const { requirementsByStage, attachments, members, statusRowsByRequirement } = await gateContext(
    opportunityId,
    crossed.map((s) => s.code),
  );
  if (Object.keys(requirementsByStage).length === 0) return;

  const gateResult = evaluateCrossing({
    fromCode,
    toCode,
    stages,
    requirementsByStage,
    opportunity: opportunityAfterMove,
    attachments,
    members,
    statusRowsByRequirement,
    // No asOf: a live move is evaluated against whatever the read just
    // returned — there is no separate "now" to source it from. asOf only
    // matters for a historical/audit read, which would pass a Stage's past
    // entry time instead — not needed by anything in this spec.
  });

  if (!gateResult.blocked) return;

  const missing = gateResult.missing
    .map(({ stage, requirement }) => `${requirement.label} (${STAGE_LABELS[stage.code] || stage.label})`)
    .join(", ");
  throw new Error(`Cannot move to ${STAGE_LABELS[toCode] || toCode} — missing: ${missing}.`);
}

/**
 * D42 — a `deadline` requirement's "entry into the Stage" timestamp: the
 * most recent STAGE_CHANGED note landing this opportunity on its current
 * Stage (`metadata.to`), the same note `updateStatus` already writes on
 * every move. A deal still sitting on its very first Stage never got one —
 * nothing moved it there — so its own `created_at` stands in. No new
 * timestamp column, per D42.
 */
function stageEnteredAt(opportunity, logs) {
  const entries = (logs || [])
    .filter(
      (log) => log.metadata?.event === "STAGE_CHANGED" && log.metadata?.to === opportunity.status,
    )
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return entries[0]?.created_at || opportunity.created_at;
}

/**
 * Every active `deadline` requirement on each of the given opportunities'
 * own current Stage, evaluated against "now" (`deadlineStatus`, ticket 1).
 * Shared by the board countdown (`getDeadlineStatuses`) and the
 * approach/breach notification check (`checkDeadlineNotifications`, ticket
 * 7) so both read the same evaluation rather than each re-deriving it —
 * same reasoning as `gateContext` for the blocking kinds.
 *
 * Returns `{ [opportunityId]: Array<{ requirement, daysRemaining, isBreached,
 * isApproaching }> }` — a Stage carrying more than one `deadline`
 * requirement is unusual (the spec's own examples never configure two on
 * the same Stage) but not disallowed, so this returns all of them rather
 * than assuming one.
 */
async function deadlineEvaluations(opportunities) {
  if (opportunities.length === 0) return {};
  const stageCodes = [...new Set(opportunities.map((o) => o.status))];

  const { requirements, requirementsByStage } = await requirementsByStageFor(stageCodes, (query) =>
    query.eq("kind", REQUIREMENT_KINDS.DEADLINE),
  );
  if (requirements.length === 0) return {};

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
    const stageRequirements = requirementsByStage[opportunity.status];
    if (!stageRequirements || stageRequirements.length === 0) continue;

    const enteredAt = stageEnteredAt(opportunity, logsByOpportunity[opportunity.id]);
    result[opportunity.id] = stageRequirements.map((requirement) => ({
      requirement,
      ...deadlineStatus(requirement, { enteredAt, asOf: now }),
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

export const opportunityService = {
  async getOpportunities() {
    const { data, error } = await supabase
      .from("sales_opportunities")
      .select(PARTICIPANT_SELECT)
      .neq("is_deleted", true)
      .order("registration_date", { ascending: false })
      .order("created_at", { ascending: false });

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
   * Registers a new opportunity. `opportunity_no` is deliberately NOT sent —
   * a BEFORE INSERT trigger assigns it from a Postgres sequence so concurrent
   * registrations cannot collide.
   */
  async createOpportunity(payload, actorId) {
    const { data, error } = await supabase
      .from("sales_opportunities")
      .insert({
        registration_date: payload.registration_date,
        registered_by: actorId,
        lead_source: payload.lead_source,
        lead_source_detail: payload.lead_source_detail || null,
        client_name: payload.client_name,
        contact_person: payload.contact_person || null,
        project_title: payload.project_title,
        project_type: deriveProjectType({
          supportSales1Id: payload.support_sales_1_id,
          supportSales2Id: payload.support_sales_2_id,
          currentProjectType: payload.project_type,
        }),
        sales_reference: cleanSalesReference(payload.sales_reference),
        itb_number: (payload.itb_number || "").trim() || null,
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

    const { data, error } = await supabase
      .from("sales_opportunities")
      .update({
        lead_source: payload.lead_source,
        lead_source_detail: payload.lead_source_detail || null,
        client_name: payload.client_name,
        contact_person: payload.contact_person || null,
        project_title: payload.project_title,
        project_type: deriveProjectType({
          supportSales1Id: payload.support_sales_1_id,
          supportSales2Id: payload.support_sales_2_id,
          currentProjectType: payload.project_type,
        }),
        sales_reference: cleanSalesReference(payload.sales_reference),
        itb_number: (payload.itb_number || "").trim() || null,
        itb_exempt: Boolean(payload.itb_exempt),
        expected_award_date: payload.expected_award_date || null,
        po_date: payload.po_date || null,
        deal_owner_id: payload.deal_owner_id || null,
        closing_sales_id: payload.closing_sales_id || null,
        support_sales_1_id: payload.support_sales_1_id || null,
        support_sales_2_id: payload.support_sales_2_id || null,
        sales_director_id: payload.sales_director_id || null,
      })
      .eq("id", id)
      .select(PARTICIPANT_SELECT)
      .single();

    if (error) throw error;

    await opportunityService.replaceItems(id, payload.items);
    const final = await opportunityService.getOpportunityById(id);

    const changes = [];
    const checkField = (field, label) => {
      if (existing[field] !== final[field]) {
        changes.push(`${label} changed from "${existing[field] || 'None'}" to "${final[field] || 'None'}"`);
      }
    };

    checkField('lead_source', 'Lead Source');
    checkField('lead_source_detail', 'Referral');
    checkField('client_name', 'Client');
    checkField('contact_person', 'Contact Person');
    checkField('project_title', 'Project');
    checkField('project_type', 'Sales Division');
    checkField('sales_reference', 'Sales Reference');
    checkField('itb_number', 'ITB Number');
    // Booleans read as "changed from false to true" through checkField, which
    // says nothing to whoever reads the log line. Named as the claim it is.
    if (Boolean(existing.itb_exempt) !== Boolean(final.itb_exempt)) {
      changes.push(
        final.itb_exempt
          ? 'Marked outright — no bidding required, so no ITB Number applies'
          : 'Outright marking removed — an ITB Number applies again',
      );
    }
    checkField('expected_award_date', 'Expected Award Date');
    checkField('po_date', 'PO Date');

    const checkEmployee = (idField, objField, label) => {
      if (existing[idField] !== final[idField]) {
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

    const newItems = payload.items || [];
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
    } else {
      systemAuditLogService.addSystemEvent(
        "OPPORTUNITY",
        id,
        `${auditLabel(data)} items updated.`,
        { event: "OPPORTUNITY_UPDATED", employeeId: actorId },
        actorId,
      ).catch(console.error);
    }

    // A `field`-kind requirement on the Stage this deal is still sitting on
    // (e.g. po_date at PMS) is satisfied the moment the field is saved —
    // this call is "the existing field-save path" ticket 5 hooks into, not
    // a separate satisfaction action.
    await narrateNewlySatisfied(
      id,
      existing.status,
      { opportunity: existing },
      { opportunity: final },
      actorId,
    );

    return final;
  },

  /**
   * Moves an opportunity to a new pipeline stage and records the move on its
   * timeline. `lostReason` is required when moving to CLOSED_LOST;
   * `salesReference` is required when leaving Lead and none is on record yet
   * (mirrored by a trigger — see migration 0011).
   *
   * Crossing the ITB gate needs `itbNumber`, or `itbExempt` to declare the
   * deal outright — an award with no bidding involved, which has no ITB
   * Number to give. The exemption is a claim someone makes about the deal, so
   * it is written to the timeline and the audit log the same way a recorded
   * Sales Reference is, never applied silently (migration 0038).
   */
  async updateStatus(
    id,
    nextStatus,
    actorId,
    lostReason = null,
    salesReference = null,
    itbNumber = null,
    itbExempt = false,
  ) {
    const { data: existing, error: readError } = await supabase
      .from("sales_opportunities")
      // Full row, not a narrow column list: a `field`-kind requirement's
      // `config.column` can name any column on this table, so the Stage Gate
      // Engine check below needs whatever a Super Admin configured it to be,
      // not a fixed set decided ahead of time.
      .select("*")
      .eq("id", id)
      .single();
    if (readError) throw readError;

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

    const providedItb = (itbNumber || "").trim() || null;
    // Whether the gate is satisfied is asked of the opportunity as it will be
    // after this move, not as it is now — the number or the exemption arriving
    // with the move is what unblocks it.
    const declaresExempt = Boolean(itbExempt) && !existing.itb_exempt;
    const satisfiesItbGate = itbGateSatisfiedBy({
      itb_number: providedItb || existing.itb_number,
      itb_exempt: Boolean(itbExempt) || existing.itb_exempt,
    });

    if (requiresItbNumber(existing.status, nextStatus) && !satisfiesItbGate) {
      throw new Error(
        "An ITB Number (Invitation to Bid) is required before this opportunity can move to For Bidding or beyond, unless it is marked outright (no bidding required).",
      );
    }

    const patch = {
      status: nextStatus,
      lost_reason: isLostCode(nextStatus) ? lostReason : null,
    };
    const recordsRef = providedRef && providedRef !== existing.sales_reference;
    if (recordsRef) patch.sales_reference = providedRef;

    const recordsItb = providedItb && providedItb !== existing.itb_number;
    if (recordsItb) patch.itb_number = providedItb;

    if (declaresExempt) patch.itb_exempt = true;

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

    if (declaresExempt) {
      // The salesperson answered the gate with "there was no bidding" rather
      // than a number. That is a claim about how the deal was won, so it is
      // recorded where the deal's history is read, not just stored as a flag
      // on the row — otherwise the only trace of why the gate let this one
      // through would be a silent boolean.
      await opportunityService.addSystemNote(
        id,
        `Marked outright — no bidding required, so no ITB Number applies.`,
        { event: "ITB_EXEMPT_DECLARED", employeeId: actorId },
        actorId,
      );

      systemAuditLogService.addSystemEvent(
        "OPPORTUNITY",
        id,
        `${auditLabel(existing)}: marked outright — no bidding required, advanced without an ITB Number.`,
        { event: "ITB_EXEMPT_DECLARED", employeeId: actorId },
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
      procurementService
        .notifyDealClosed(id, actorId, lostReason)
        .catch(console.error);
    }

    return data;
  },

  async deleteOpportunity(id, actorId) {
    const { data, error } = await supabase
      .from("sales_opportunities")
      .update({ is_deleted: true })
      .eq("id", id)
      .select("id, client_name, sales_reference")
      .single();

    if (error) throw error;

    procurementService
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
      }));

    if (rows.length > 0) {
      const { error: insError } = await supabase
        .from("sales_opportunity_items")
        .insert(rows);
      if (insError) throw insError;
    }
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
    if (files.length > 0) {
      const [{ data: opportunity }, { data: priorLogs }] = await Promise.all([
        supabase.from("sales_opportunities").select("status").eq("id", opportunityId).single(),
        supabase
          .from("sales_opportunity_logs")
          .select("author_id, created_at, metadata")
          .eq("opportunity_id", opportunityId),
      ]);
      stageCode = opportunity?.status;
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

      await Promise.all(
        live
          // Mentioning yourself is a way of writing, not a request for a
          // notification.
          .filter((m) => m.id !== authorId)
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
  async addMember(opportunityId, employeeId, actorId) {
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
      .select("status")
      .eq("id", opportunityId)
      .single();
    if (opportunityError) throw opportunityError;

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

    await narrateNewlySatisfied(
      opportunityId,
      opportunity.status,
      { members: membersForGate(existingMembers) },
      { members: membersForGate([...existingMembers, data]) },
      actorId,
    );

    return data;
  },

  // ── Stage requirements — tickbox satisfaction ───────────────────────────────

  /**
   * Ticks a `tickbox` requirement for this deal. The one kind with no other
   * evidence (docs/stage-gate-engine-spec.md), so the status row IS the
   * certification — unlike attachment/field/assignment, there is no live
   * record to evaluate, only this direct action. Idempotent: a requirement
   * once satisfied stays satisfied (D31), so ticking it again is a no-op
   * that returns the original row rather than overwriting who satisfied it.
   */
  async satisfyRequirement(opportunityId, requirementId, actorId) {
    const { data: requirement, error: requirementError } = await supabase
      .from("stage_requirements")
      .select("*")
      .eq("id", requirementId)
      .single();
    if (requirementError) throw requirementError;

    if (requirement.kind !== REQUIREMENT_KINDS.TICKBOX) {
      throw new Error("Only a tickbox requirement can be satisfied this way.");
    }
    if (requirement.archived_at) {
      throw new Error("This requirement has been archived and no longer applies.");
    }

    const { data: existingStatus, error: statusError } = await supabase
      .from("sor_requirement_status")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .eq("requirement_id", requirementId)
      .maybeSingle();
    if (statusError) throw statusError;
    if (existingStatus) return existingStatus;

    const { data, error } = await supabase
      .from("sor_requirement_status")
      .insert({ opportunity_id: opportunityId, requirement_id: requirementId, satisfied_by: actorId })
      .select()
      .single();
    if (error) throw error;

    await noteRequirementSatisfied(opportunityId, requirement, actorId);

    return data;
  },

  // ── Deal Owner visibility (ticket 6) ────────────────────────────────────────

  /**
   * What the deal's current Stage owes, right now — every one of its live
   * (non-archived, non-`deadline`) requirements alongside `evaluateRequirement`'s
   * verdict, so a Deal Owner can see the whole list before trying to move
   * instead of being refused one item at a time. Deadline requirements never
   * block and have their own display surface (ticket 7), so they're left out.
   *
   * `opportunity` can be passed in when the caller already has it (the
   * details modal always does) to skip a redundant read.
   */
  async getStageChecklist(opportunityId, opportunity = null) {
    const target = opportunity || (await opportunityService.getOpportunityById(opportunityId));
    if (!target) return [];
    const stageCode = target.status;

    const { requirementsByStage, attachments, members, statusRowsByRequirement } = await gateContext(
      opportunityId,
      [stageCode],
    );

    const requirements = (requirementsByStage[stageCode] || [])
      .filter((r) => r.kind !== REQUIREMENT_KINDS.DEADLINE)
      .sort((a, b) => a.sort_order - b.sort_order);

    return requirements.map((requirement) => ({
      requirement,
      ...evaluateRequirement(requirement, {
        opportunity: target,
        attachments,
        members,
        statusRow: statusRowsByRequirement[requirement.id] ?? null,
      }),
    }));
  },

  /**
   * A Sales Director's register-level read (story 25): every one of the
   * given deals that is blocked on its own current Stage, and what it's
   * missing. One bulk read instead of one checklist call per row — `opportunities`
   * is whatever the register already has loaded, not re-fetched here.
   *
   * Returns `{ [opportunityId]: requirement[] }`, present only for a deal
   * that actually has something outstanding.
   */
  async getBlockedDeals(opportunities = []) {
    if (opportunities.length === 0) return {};
    const stageCodes = [...new Set(opportunities.map((o) => o.status))];

    const { requirements, requirementsByStage } = await requirementsByStageFor(stageCodes, (query) =>
      query.eq("is_required", true).neq("kind", REQUIREMENT_KINDS.DEADLINE),
    );
    if (requirements.length === 0) return {};

    const opportunityIds = opportunities.map((o) => o.id);
    const requirementIds = requirements.map((r) => r.id);
    const [{ data: statusRows, error: statusError }, { data: logs, error: logsError }, { data: memberRows, error: memberError }] =
      await Promise.all([
        supabase
          .from("sor_requirement_status")
          .select("*")
          .in("opportunity_id", opportunityIds)
          .in("requirement_id", requirementIds),
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

    const membersByOpportunity = groupBy(memberRows, "opportunity_id");
    for (const opportunityId of Object.keys(membersByOpportunity)) {
      membersByOpportunity[opportunityId] = membersForGate(membersByOpportunity[opportunityId]);
    }

    const statusByOpportunity = {};
    for (const row of statusRows || []) {
      (statusByOpportunity[row.opportunity_id] ??= {})[row.requirement_id] = row;
    }

    const blocked = {};
    for (const opportunity of opportunities) {
      const stageRequirements = requirementsByStage[opportunity.status] || [];
      if (stageRequirements.length === 0) continue;

      const missing = stageRequirements.filter(
        (requirement) =>
          evaluateRequirement(requirement, {
            opportunity,
            attachments: attachmentsByOpportunity[opportunity.id] || [],
            members: membersByOpportunity[opportunity.id] || [],
            statusRow: (statusByOpportunity[opportunity.id] || {})[requirement.id] ?? null,
          }).status === REQUIREMENT_STATUS.UNSATISFIED,
      );
      if (missing.length > 0) blocked[opportunity.id] = missing;
    }

    return blocked;
  },

  // ── Deadline kind — countdown + notifications (ticket 7) ────────────────────

  /**
   * The board card countdown, and the register's "past a deadline" read
   * (story 26): the most urgent active `deadline` requirement on each
   * opportunity's own current Stage, evaluated against "now". Absent for an
   * opportunity whose Stage carries no live `deadline` requirement.
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

      for (const { requirement, daysRemaining, isBreached, isApproaching } of items) {
        const milestone = isBreached ? "BREACHED" : isApproaching ? "APPROACHING" : null;
        if (!milestone) continue;

        const event = `STAGE_DEADLINE_${milestone}`;
        const { data: existing, error: existingError } = await supabase
          .from("sales_opportunity_logs")
          .select("id")
          .eq("opportunity_id", opportunityId)
          .eq("metadata->>event", event)
          .eq("metadata->>requirementId", requirement.id)
          .limit(1);
        if (existingError) throw existingError;
        if (existing && existing.length > 0) continue;

        const stageLabel = STAGE_LABELS[opportunity.status] || opportunity.status;
        const { title, describe } = DEADLINE_MILESTONES[milestone];
        const content = describe(requirement.label, stageLabel, daysRemaining);

        // No actorId — nobody did anything to cause this, time simply
        // passed, so there's no human to attribute it to (addSystemNote
        // defaults author_id to null for exactly this case).
        await opportunityService.addSystemNote(opportunityId, content, {
          event,
          requirementId: requirement.id,
          label: requirement.label,
          daysRemaining,
        });

        await notificationService.createNotification({
          recipient_id: opportunity.deal_owner_id,
          type: `OPPORTUNITY_DEADLINE_${milestone}`,
          title,
          message: content,
          reference_id: opportunityId,
        });

        notified.push({ opportunityId, requirementId: requirement.id, milestone });
      }
    }

    return notified;
  },
};
