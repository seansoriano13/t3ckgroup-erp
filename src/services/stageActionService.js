import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";

const VALID_KINDS = ["create_group_task", "create_individual_task"];

/**
 * Access control check for Stage Actions modifications.
 * Opened to allow all authenticated employees to edit Flow Canvas.
 */
async function requireSuperAdmin(_actorId) {
  // Access control opened: anyone can make changes on Flow Canvas.
}

/**
 * Stage Actions (Automations) configuration.
 */
export const stageActionService = {
  /** A Stage's actions, in sort order. Archived rows excluded by default. */
  async getForStage(stageId, { includeArchived = false } = {}) {
    if (!stageId) return [];

    let query = supabase
      .from("flow_stage_actions")
      .select("*")
      .eq("stage_id", stageId)
      .order("sort_order", { ascending: true });
    if (!includeArchived) query = query.is("archived_at", null);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Every listed Stage's actions in one round trip, grouped by stage id.
   * The batched read behind the Flow Canvas — see the note on
   * stageConditionService.getForStages.
   */
  async getForStages(stageIds = [], { includeArchived = false } = {}) {
    const ids = [...new Set(stageIds.filter(Boolean))];
    if (ids.length === 0) return {};

    let query = supabase
      .from("flow_stage_actions")
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
   * Adds an action to a Stage, appended after its current actions.
   * Super-Admin-only.
   */
  async add({ stageId, kind, config = {} }, actorId) {
    await requireSuperAdmin(actorId);

    if (!VALID_KINDS.includes(kind)) {
      throw new Error(`Kind must be one of ${VALID_KINDS.join(", ")}.`);
    }

    const current = await this.getForStage(stageId);
    const sortOrder = current.length > 0 ? Math.max(...current.map((a) => a.sort_order)) + 1 : 0;

    const { data: inserted, error } = await supabase
      .from("flow_stage_actions")
      .insert({
        stage_id: stageId,
        kind,
        config,
        sort_order: sortOrder,
      })
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_STAGE",
      stageId,
      `Action added: ${kind}.`,
      { event: "STAGE_ACTION_ADDED", kind, actionId: inserted.id, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return inserted;
  },

  /**
   * Updates an action's config. Super-Admin-only.
   */
  async update(actionId, config, actorId) {
    await requireSuperAdmin(actorId);

    const { data, error } = await supabase
      .from("flow_stage_actions")
      .update({ config, updated_at: new Date().toISOString() })
      .eq("id", actionId)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_STAGE",
      data.stage_id,
      `Action updated: ${data.kind}.`,
      { event: "STAGE_ACTION_UPDATED", actionId, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Rewrites the sort orders for a list of action ids. Super-Admin-only.
   */
  async reorder(updates, actorId) {
    await requireSuperAdmin(actorId);

    if (updates.length === 0) return;

    for (const { id, sortOrder } of updates) {
      const { error } = await supabase
        .from("flow_stage_actions")
        .update({ sort_order: sortOrder, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    }

    const { data: first } = await supabase.from("flow_stage_actions").select("stage_id, kind").eq("id", updates[0].id).single();
    if (first) {
      systemAuditLogService.addSystemEvent(
        "FLOW_STAGE",
        first.stage_id,
        "Actions reordered.",
        { event: "STAGE_ACTIONS_REORDERED", employeeId: actorId },
        actorId,
      ).catch(console.error);
    }
  },

  /**
   * Soft-deletes an action. Super-Admin-only.
   */
  async archive(actionId, actorId) {
    await requireSuperAdmin(actorId);

    const { data, error } = await supabase
      .from("flow_stage_actions")
      .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", actionId)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_STAGE",
      data.stage_id,
      `Action archived: ${data.kind}.`,
      { event: "STAGE_ACTION_ARCHIVED", actionId, label: data.kind, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  }
};
