import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";
import { CONDITION_KINDS, NEW_CONDITION_KINDS } from "../constants/stageGate";

// Issue #203: the picker only offers these four kinds for a *new* condition.
// `field` and `project_evaluation` are removed (Stage Fields replace the
// first, nobody used the second); `inclusions` and the old `purchasing` kind
// are hidden pending the Purchase Requests spec, but every stored kind still
// evaluates and can still be `update`d, so an SOR built against an older
// flow version is never stranded.
const VALID_KINDS = NEW_CONDITION_KINDS;

/**
 * Access control check for Stage Conditions modifications.
 * Opened to allow all authenticated employees to edit Flow Canvas.
 */
async function requireSuperAdmin(_actorId) {
  // Access control opened: anyone can make changes on Flow Canvas.
}

/**
 * Stage Gate Engine, ticket 5 (.scratch/stage-gate-engine/issues/05-per-kind-
 * satisfaction.md) — "a satisfied condition and an archived condition
 * both write timeline entries, as does an assignment". Every deal currently
 * sitting on the condition's Stage gets a note when it is archived (issue
 * #36's rule) or added (issue #41's — a rule that has just been decided to
 * matter should apply to the deals in front of you, so a user who suddenly
 * can't advance a deal deserves to know why). A deal that has already moved
 * past this Stage isn't touched either way: its crossing was already
 * evaluated (or blocked) under whatever conditions existed at the time.
 *
 * Not `opportunityService.addSystemNote` — this file replicates rather than
 * imports across service modules (see `requireSuperAdmin`, above, and its
 * own prior art in commissionService).
 */
async function noteConditionEventOnDealsAtStage(condition, actorId, { event, content }) {
  const { data: deals, error } = await supabase
    .from("sales_opportunities")
    .select("id")
    .eq("flow_stage_id", condition.stage_id)
    .neq("is_deleted", true)
    // Issue #36, migration 0046 — a Scratch SOR has no timeline anybody reads
    // for its own sake, so a config-change note on one is noise.
    .eq("is_scratch", false)
    // Issue #170/#171 — same reasoning for a retail order: nobody reads its
    // timeline for its own sake either.
    .eq("is_retail", false);
  if (error) throw error;
  if (!deals || deals.length === 0) return;

  const rows = deals.map((deal) => ({
    opportunity_id: deal.id,
    author_id: actorId,
    type: "SYSTEM",
    content,
    metadata: { event, conditionId: condition.id, label: condition.label, employeeId: actorId },
  }));

  const { error: insertError } = await supabase.from("sales_opportunity_logs").insert(rows);
  if (insertError) console.error(`Failed to write ${event} notes:`, insertError);
}

const noteArchivalOnDealsAtStage = (condition, actorId) =>
  noteConditionEventOnDealsAtStage(condition, actorId, {
    event: "STAGE_CONDITION_ARCHIVED",
    content: `Condition no longer applies: "${condition.label}" (archived).`,
  });

const noteAdditionOnDealsAtStage = (condition, actorId) =>
  noteConditionEventOnDealsAtStage(condition, actorId, {
    event: "STAGE_CONDITION_ADDED",
    content: `Condition now applies: "${condition.label}" (added).`,
  });

/**
 * Stage Gate Engine configuration (docs/stage-gate-engine-spec.md, ticket 3
 * of .scratch/stage-gate-engine/issues/) — add, reorder and archive a
 * Stage's conditions. Every write is Super-Admin-gated and audit-logged.
 *
 * Reading `stage_conditions` for evaluation is ticket 1's pure module,
 * called from ticket 2's gate check — not this service. `getForStage` here
 * exists for ticket 4's settings screen, not the live gate.
 */
export const stageConditionService = {
  /** A Stage's conditions, in sort order. Archived rows excluded by default — a config screen edits the live set, not history. */
  async getForStage(stageId, { includeArchived = false } = {}) {
    if (!stageId) return [];

    let query = supabase
      .from("stage_conditions")
      .select("*")
      .eq("stage_id", stageId)
      .order("sort_order", { ascending: true });
    if (!includeArchived) query = query.is("archived_at", null);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Every listed Stage's conditions in one round trip, grouped by stage id.
   *
   * The Flow Canvas draws every Stage's gate at once, so asking per Stage would
   * fire one request per node on every flow switch. Stages with no conditions
   * are present as empty arrays — a caller reading `byStage[id]` never has to
   * distinguish "none" from "not fetched".
   */
  async getForStages(stageIds = [], { includeArchived = false } = {}) {
    const ids = [...new Set(stageIds.filter(Boolean))];
    if (ids.length === 0) return {};

    let query = supabase
      .from("stage_conditions")
      .select("*")
      .in("stage_id", ids)
      .order("sort_order", { ascending: true });
    if (!includeArchived) query = query.is("archived_at", null);

    const { data, error } = await query;
    if (error) throw error;

    const byStage = Object.fromEntries(ids.map((id) => [id, []]));
    for (const row of data || []) byStage[row.stage_id]?.push(row);
    return byStage;
  },

  /**
   * Adds a condition to a Stage, appended after its current conditions.
   * Super-Admin-only.
   */
  async add({ stageId, kind, label, isRequired = true, config = {} }, actorId) {
    await requireSuperAdmin(actorId);

    if (!VALID_KINDS.includes(kind)) {
      throw new Error(`Kind must be one of ${VALID_KINDS.join(", ")}.`);
    }
    const trimmedLabel = (label || "").trim();
    if (!trimmedLabel) {
      throw new Error("A condition needs a label.");
    }
    // The UI enforces `min="1"` on the days field, but that's client-side
    // only — a `deadline` condition with `config.days <= 0` would read to
    // deadlineStatus (constants/stageGate.js) as already breached the
    // instant it's created, which is never a real deadline.
    if (kind === CONDITION_KINDS.DEADLINE && !(Number(config?.days) > 0)) {
      throw new Error("A deadline condition needs a positive number of days.");
    }

    // Read-then-write: two Super Admins adding to the same Stage at the
    // same instant could tie on sort_order. Accepted rather than guarded —
    // `sort_order` carries no unique constraint (see reorder(), below) so a
    // tie doesn't error, just leaves order between the two down to
    // incidental read order, and this is a rare, one-admin-in-a-meeting
    // action, not a bulk or concurrent write path.
    const siblings = await this.getForStage(stageId, { includeArchived: true });

    const { data, error } = await supabase
      .from("stage_conditions")
      .insert({
        stage_id: stageId,
        kind,
        label: trimmedLabel,
        is_required: Boolean(isRequired),
        sort_order: siblings.length,
        config: config || {},
      })
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "STAGE_CONDITION",
      data.id,
      `Condition added to stage: "${trimmedLabel}" (${kind}).`,
      { event: "STAGE_CONDITION_ADDED", stageId, kind, label: trimmedLabel, employeeId: actorId },
      actorId,
    ).catch(console.error);

    await noteAdditionOnDealsAtStage(data, actorId);

    return data;
  },

  /**
   * Edits a saved condition's label, required flag and config — never its
   * kind (issue #203, story 5: an SOR's existing evidence should never be
   * judged under a different kind; changing kind means archive-and-add).
   * Refuses once the owning flow has been published — a published flow's
   * conditions are read-only everywhere (story 6); "Edit draft" is the only
   * door back in.
   */
  async update(id, { label, isRequired, config, kind } = {}, actorId) {
    await requireSuperAdmin(actorId);

    const { data: existing, error: fetchError } = await supabase
      .from("stage_conditions")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchError) throw fetchError;

    const { data: stage, error: stageError } = await supabase
      .from("flow_stages")
      .select("flow_id")
      .eq("id", existing.stage_id)
      .single();
    if (stageError) throw stageError;

    if (stage?.flow_id) {
      const { data: flow, error: flowError } = await supabase
        .from("sales_flows")
        .select("state")
        .eq("id", stage.flow_id)
        .single();
      if (flowError) throw flowError;
      if (flow?.state && flow.state !== "draft") {
        throw new Error("A published flow's conditions are read-only. Edit the draft instead.");
      }
    }

    if (kind !== undefined && kind !== existing.kind) {
      throw new Error("A condition's kind is fixed once saved. Archive it and add a new one instead.");
    }

    const patch = {};
    if (label !== undefined) {
      const trimmedLabel = (label || "").trim();
      if (!trimmedLabel) throw new Error("A condition needs a label.");
      patch.label = trimmedLabel;
    }
    if (isRequired !== undefined) patch.is_required = Boolean(isRequired);
    if (config !== undefined) {
      const kind = existing.kind;
      if (kind === CONDITION_KINDS.DEADLINE && !(Number(config?.days) > 0)) {
        throw new Error("A deadline condition needs a positive number of days.");
      }
      patch.config = config || {};
    }

    if (Object.keys(patch).length === 0) return existing;

    const { data, error } = await supabase
      .from("stage_conditions")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "STAGE_CONDITION",
      id,
      `Condition updated: "${data.label}".`,
      { event: "STAGE_CONDITION_UPDATED", stageId: data.stage_id, label: data.label, employeeId: actorId },
      actorId,
    ).catch(console.error);

    await noteConditionEventOnDealsAtStage(data, actorId, {
      event: "STAGE_CONDITION_UPDATED",
      content: `Condition updated: "${data.label}".`,
    });

    return data;
  },

  /**
   * Reorders conditions — `updates` is `[{ id, sortOrder }]`. Unlike
   * `pipelineStageService.reorderStages`, `stage_conditions.sort_order`
   * carries no unique constraint (0041), so a plain batch write is safe —
   * no placeholder-swap needed to dodge a collision that can't happen.
   * Super-Admin-only.
   */
  async reorder(updates, actorId) {
    await requireSuperAdmin(actorId);

    await Promise.all(
      updates.map(async ({ id, sortOrder }) => {
        const { error } = await supabase
          .from("stage_conditions")
          .update({ sort_order: sortOrder })
          .eq("id", id);
        if (error) throw error;
      }),
    );

    systemAuditLogService.addSystemEvent(
      "STAGE_CONDITION",
      null,
      `Reordered ${updates.length} condition(s).`,
      { event: "STAGE_CONDITION_REORDERED", updates, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return true;
  },

  /**
   * Archives a condition — soft only (D21): stops it from blocking future
   * moves (ticket 2's gate reads `archived_at is null`), but never deletes
   * the row or the `sor_condition_status` history that satisfied it. The
   * only escape route from a condition — no per-deal override exists.
   * Super-Admin-only.
   */
  async archive(id, actorId) {
    await requireSuperAdmin(actorId);

    const { data, error } = await supabase
      .from("stage_conditions")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "STAGE_CONDITION",
      id,
      `Condition archived: "${data.label}" (${data.stage_id}).`,
      { event: "STAGE_CONDITION_ARCHIVED", stageId: data.stage_id, label: data.label, employeeId: actorId },
      actorId,
    ).catch(console.error);

    await noteArchivalOnDealsAtStage(data, actorId);

    return data;
  },
};
