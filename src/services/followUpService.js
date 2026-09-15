import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";

/**
 * Access control check for Follow-up Cadence changes. Mirrors
 * `stageFieldService`'s `requireSuperAdmin` — opened to allow all
 * authenticated employees to edit Flow Canvas.
 */
async function requireSuperAdmin(_actorId) {
  // Access control opened: anyone can make changes on Flow Canvas.
}

function shapeRow(row) {
  if (!row) return null;
  return {
    stageId: row.stage_id,
    enabled: Boolean(row.enabled),
    everyDays: row.every_days,
    recipients: row.recipients || [],
    proofRequired: row.proof_required !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Follow-up Cadence (issue #204 Part 3) — CRUD over `flow_stage_follow_ups`,
 * one row per Stage, the same draft-only shape as `stageFieldService`:
 * read/write work on any flow, but the General tab that calls this only
 * ever renders for a draft.
 */
export const followUpService = {
  /** A Stage's cadence, or null when none has ever been saved for it. */
  async getForStage(stageId) {
    if (!stageId) return null;
    const { data, error } = await supabase
      .from("flow_stage_follow_ups")
      .select("*")
      .eq("stage_id", stageId)
      .maybeSingle();
    if (error) throw error;
    return shapeRow(data);
  },

  /** Every listed Stage's cadence in one round trip, keyed by stage id — stages with no saved row are omitted. */
  async getForStages(stageIds = []) {
    const ids = [...new Set(stageIds.filter(Boolean))];
    if (ids.length === 0) return {};

    const { data, error } = await supabase.from("flow_stage_follow_ups").select("*").in("stage_id", ids);
    if (error) throw error;

    const byStage = {};
    for (const row of data || []) byStage[row.stage_id] = shapeRow(row);
    return byStage;
  },

  /** Upserts a Stage's cadence — one row per Stage, on `stage_id`. */
  async save(stageId, { enabled = false, everyDays = null, recipients = [], proofRequired = true } = {}, actorId) {
    await requireSuperAdmin(actorId);
    if (!stageId) throw new Error("A Stage is required to save a Follow-up Cadence.");
    if (enabled && !(Number(everyDays) > 0)) {
      throw new Error("Every N days must be a positive number when the cadence is on.");
    }

    const { data, error } = await supabase
      .from("flow_stage_follow_ups")
      .upsert(
        {
          stage_id: stageId,
          enabled: Boolean(enabled),
          every_days: everyDays ?? null,
          recipients: recipients || [],
          proof_required: proofRequired !== false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stage_id" },
      )
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "STAGE_FOLLOW_UP",
      stageId,
      `Follow-up Cadence ${enabled ? "enabled" : "disabled"} for stage.`,
      { event: "STAGE_FOLLOW_UP_SAVED", stageId, enabled, everyDays, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return shapeRow(data);
  },
};
