import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";

/**
 * Access control check for Flow Canvas access-setting changes. Mirrors
 * `salesFlowService`'s `requireSuperAdmin` — opened to allow all
 * authenticated employees to edit Flow Canvas (RLS is the real gate, per
 * 20260923000000_flow_access_settings.sql).
 */
async function requireSuperAdmin(_actorId) {
  // Access control opened: anyone can make changes on Flow Canvas.
}

function shapeFlowAccess(row) {
  if (!row) return null;
  return {
    flowId: row.flow_id,
    alwaysSees: row.always_sees || [],
    journeyViewers: row.journey_viewers ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function shapeStageAccess(row) {
  if (!row) return null;
  return {
    stageId: row.stage_id,
    shutOutRoles: row.shut_out_roles || [],
    excludedGroupIds: row.excluded_group_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Access configuration (issue #292, part of #208/ADR 0021) — who always
 * sees a Sale Type's SORs, who may open the Journey, and which Deal Team
 * roles/Employee Groups are shut out per Stage. Configuration only: nothing
 * here enforces the access itself yet.
 */
export const flowAccessService = {
  /** A flow's Always sees/Journey viewers, or null when never saved. */
  async getForFlow(flowId) {
    if (!flowId) return null;
    const { data, error } = await supabase
      .from("flow_access_settings")
      .select("*")
      .eq("flow_id", flowId)
      .maybeSingle();
    if (error) throw error;
    return shapeFlowAccess(data);
  },

  /** Upserts a flow's Always sees/Journey viewers — one row per flow, on `flow_id`. */
  async saveForFlow(flowId, { alwaysSees = [], journeyViewers = null } = {}, actorId) {
    await requireSuperAdmin(actorId);
    if (!flowId) throw new Error("A Sales Flow is required to save Access settings.");

    const { data, error } = await supabase
      .from("flow_access_settings")
      .upsert(
        {
          flow_id: flowId,
          always_sees: alwaysSees || [],
          journey_viewers: journeyViewers,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "flow_id" },
      )
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "SALES_FLOW",
      flowId,
      "Access settings updated.",
      { event: "FLOW_ACCESS_SETTINGS_SAVED", flowId, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return shapeFlowAccess(data);
  },

  /** A Stage's shut-out roles/excluded groups, or null when none has ever been saved for it. */
  async getForStage(stageId) {
    if (!stageId) return null;
    const { data, error } = await supabase
      .from("flow_stage_access")
      .select("*")
      .eq("stage_id", stageId)
      .maybeSingle();
    if (error) throw error;
    return shapeStageAccess(data);
  },

  /** Every listed Stage's access row in one round trip, keyed by stage id — stages with no saved row are omitted. */
  async getForStages(stageIds = []) {
    const ids = [...new Set(stageIds.filter(Boolean))];
    if (ids.length === 0) return {};

    const { data, error } = await supabase.from("flow_stage_access").select("*").in("stage_id", ids);
    if (error) throw error;

    const byStage = {};
    for (const row of data || []) byStage[row.stage_id] = shapeStageAccess(row);
    return byStage;
  },

  /** Upserts a Stage's shut-out roles/excluded groups — one row per Stage, on `stage_id`. */
  async saveForStage(stageId, { shutOutRoles = [], excludedGroupIds = [] } = {}, actorId) {
    await requireSuperAdmin(actorId);
    if (!stageId) throw new Error("A Stage is required to save Access settings.");

    const { data, error } = await supabase
      .from("flow_stage_access")
      .upsert(
        {
          stage_id: stageId,
          shut_out_roles: shutOutRoles || [],
          excluded_group_ids: excludedGroupIds || [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stage_id" },
      )
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "STAGE_ACCESS",
      stageId,
      "Stage Access settings updated.",
      { event: "STAGE_ACCESS_SAVED", stageId, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return shapeStageAccess(data);
  },
};
