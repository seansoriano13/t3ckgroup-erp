import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";
import { REQUIREMENT_KINDS } from "../constants/stageGate";

const VALID_KINDS = Object.values(REQUIREMENT_KINDS);

/**
 * Throws unless `actorId` is a Super Admin. Enforced independently at the
 * database via RLS (0041's `stage_requirements_write` policy) — this check
 * exists so the failure is immediate, testable without a real database, and
 * doesn't depend on trusting a client-supplied permission flag. Prior art:
 * commissionService.requireSuperAdmin.
 */
async function requireSuperAdmin(actorId) {
  const { data, error } = await supabase
    .from("employees")
    .select("is_super_admin")
    .eq("id", actorId)
    .single();
  if (error) throw error;

  if (!data?.is_super_admin) {
    throw new Error("Only a Super Admin can change a Stage's requirements.");
  }
}

/**
 * Stage Gate Engine, ticket 5 (.scratch/stage-gate-engine/issues/05-per-kind-
 * satisfaction.md) — "a satisfied requirement and an archived requirement
 * both write timeline entries, as does an assignment". Every deal currently
 * sitting on the archived requirement's Stage gets a note — those are the
 * deals whose "what this Stage owes" view just lost an item. A deal that has
 * already moved past this Stage isn't touched: its crossing was already
 * evaluated (or blocked) under whatever requirements existed at the time.
 *
 * Not `opportunityService.addSystemNote` — this file replicates rather than
 * imports across service modules (see `requireSuperAdmin`, above, and its
 * own prior art in commissionService).
 */
async function noteArchivalOnDealsAtStage(requirement, actorId) {
  const { data: deals, error } = await supabase
    .from("sales_opportunities")
    .select("id")
    .eq("status", requirement.stage_code)
    .neq("is_deleted", true);
  if (error) throw error;
  if (!deals || deals.length === 0) return;

  const rows = deals.map((deal) => ({
    opportunity_id: deal.id,
    author_id: actorId,
    type: "SYSTEM",
    content: `Requirement no longer applies: "${requirement.label}" (archived).`,
    metadata: { event: "STAGE_REQUIREMENT_ARCHIVED", requirementId: requirement.id, label: requirement.label, employeeId: actorId },
  }));

  const { error: insertError } = await supabase.from("sales_opportunity_logs").insert(rows);
  if (insertError) console.error("Failed to write requirement-archived notes:", insertError);
}

/**
 * Stage Gate Engine configuration (docs/stage-gate-engine-spec.md, ticket 3
 * of .scratch/stage-gate-engine/issues/) — add, reorder and archive a
 * Stage's requirements. Every write is Super-Admin-gated and audit-logged.
 *
 * Reading `stage_requirements` for evaluation is ticket 1's pure module,
 * called from ticket 2's gate check — not this service. `getForStage` here
 * exists for ticket 4's settings screen, not the live gate.
 */
export const stageRequirementService = {
  /** A Stage's requirements, in sort order. Archived rows excluded by default — a config screen edits the live set, not history. */
  async getForStage(stageCode, { includeArchived = false } = {}) {
    if (!stageCode) return [];

    let query = supabase
      .from("stage_requirements")
      .select("*")
      .eq("stage_code", stageCode)
      .order("sort_order", { ascending: true });
    if (!includeArchived) query = query.is("archived_at", null);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Adds a requirement to a Stage, appended after its current requirements.
   * Super-Admin-only.
   */
  async add({ stageCode, kind, label, isRequired = true, config = {} }, actorId) {
    await requireSuperAdmin(actorId);

    if (!VALID_KINDS.includes(kind)) {
      throw new Error(`Kind must be one of ${VALID_KINDS.join(", ")}.`);
    }
    const trimmedLabel = (label || "").trim();
    if (!trimmedLabel) {
      throw new Error("A requirement needs a label.");
    }
    // The UI enforces `min="1"` on the days field, but that's client-side
    // only — a `deadline` requirement with `config.days <= 0` would read to
    // deadlineStatus (constants/stageGate.js) as already breached the
    // instant it's created, which is never a real deadline.
    if (kind === REQUIREMENT_KINDS.DEADLINE && !(Number(config?.days) > 0)) {
      throw new Error("A deadline requirement needs a positive number of days.");
    }

    // Read-then-write: two Super Admins adding to the same Stage at the
    // same instant could tie on sort_order. Accepted rather than guarded —
    // `sort_order` carries no unique constraint (see reorder(), below) so a
    // tie doesn't error, just leaves order between the two down to
    // incidental read order, and this is a rare, one-admin-in-a-meeting
    // action, not a bulk or concurrent write path.
    const siblings = await this.getForStage(stageCode, { includeArchived: true });

    const { data, error } = await supabase
      .from("stage_requirements")
      .insert({
        stage_code: stageCode,
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
      "STAGE_REQUIREMENT",
      data.id,
      `Requirement added to ${stageCode}: "${trimmedLabel}" (${kind}).`,
      { event: "STAGE_REQUIREMENT_ADDED", stageCode, kind, label: trimmedLabel, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Reorders requirements — `updates` is `[{ id, sortOrder }]`. Unlike
   * `pipelineStageService.reorderStages`, `stage_requirements.sort_order`
   * carries no unique constraint (0041), so a plain batch write is safe —
   * no placeholder-swap needed to dodge a collision that can't happen.
   * Super-Admin-only.
   */
  async reorder(updates, actorId) {
    await requireSuperAdmin(actorId);

    await Promise.all(
      updates.map(async ({ id, sortOrder }) => {
        const { error } = await supabase
          .from("stage_requirements")
          .update({ sort_order: sortOrder })
          .eq("id", id);
        if (error) throw error;
      }),
    );

    systemAuditLogService.addSystemEvent(
      "STAGE_REQUIREMENT",
      null,
      `Reordered ${updates.length} requirement(s).`,
      { event: "STAGE_REQUIREMENT_REORDERED", updates, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return true;
  },

  /**
   * Archives a requirement — soft only (D21): stops it from blocking future
   * moves (ticket 2's gate reads `archived_at is null`), but never deletes
   * the row or the `sor_requirement_status` history that satisfied it. The
   * only escape route from a requirement — no per-deal override exists.
   * Super-Admin-only.
   */
  async archive(id, actorId) {
    await requireSuperAdmin(actorId);

    const { data, error } = await supabase
      .from("stage_requirements")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "STAGE_REQUIREMENT",
      id,
      `Requirement archived: "${data.label}" (${data.stage_code}).`,
      { event: "STAGE_REQUIREMENT_ARCHIVED", stageCode: data.stage_code, label: data.label, employeeId: actorId },
      actorId,
    ).catch(console.error);

    await noteArchivalOnDealsAtStage(data, actorId);

    return data;
  },
};
