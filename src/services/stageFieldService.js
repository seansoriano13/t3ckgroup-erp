import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";
import { CUSTOM_FIELD_TYPE_VALUES, isSorStageField } from "../constants/stageFields";

/**
 * Access control check for Stage Fields modifications. Mirrors
 * `stageConditionService`'s `requireSuperAdmin` — opened to allow all
 * authenticated employees to edit Flow Canvas.
 */
async function requireSuperAdmin(_actorId) {
  // Access control opened: anyone can make changes on Flow Canvas.
}

function validateFieldShape({ source, sorField, fieldType, label }) {
  const trimmedLabel = (label || "").trim();
  if (!trimmedLabel) throw new Error("A field needs a label.");

  if (source === "sor") {
    if (!isSorStageField(sorField)) {
      throw new Error("That is not one of the SOR fields this Stage can ask for.");
    }
  } else if (source === "custom") {
    if (!CUSTOM_FIELD_TYPE_VALUES.includes(fieldType)) {
      throw new Error(`Field type must be one of ${CUSTOM_FIELD_TYPE_VALUES.join(", ")}.`);
    }
  } else {
    throw new Error('Source must be "sor" or "custom".');
  }
  return trimmedLabel;
}

/**
 * Stage Fields (issue #203) — CRUD over `flow_stage_fields`, the same
 * draft-only shape as `stageConditionService`: add, update and archive all
 * work on any flow (a live table has no notion of draft/published on its
 * own), but the Fields tab that calls this only ever renders for a draft —
 * a published flow's Stage panel is read-only everywhere, same as
 * Conditions.
 */
export const stageFieldService = {
  /** A Stage's fields, in sort order. Archived rows excluded by default. */
  async getForStage(stageId, { includeArchived = false } = {}) {
    if (!stageId) return [];

    let query = supabase
      .from("flow_stage_fields")
      .select("*")
      .eq("stage_id", stageId)
      .order("sort_order", { ascending: true });
    if (!includeArchived) query = query.is("archived_at", null);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /** Every listed Stage's fields in one round trip, grouped by stage id — same shape as `stageConditionService.getForStages`. */
  async getForStages(stageIds = [], { includeArchived = false } = {}) {
    const ids = [...new Set(stageIds.filter(Boolean))];
    if (ids.length === 0) return {};

    let query = supabase
      .from("flow_stage_fields")
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

  /** Adds a field to a Stage, appended after its current fields. */
  async add(
    { stageId, label, help = null, source, sorField = null, fieldType = null, options = [], isRequired = true },
    actorId,
  ) {
    await requireSuperAdmin(actorId);
    const trimmedLabel = validateFieldShape({ source, sorField, fieldType, label });

    const siblings = await this.getForStage(stageId, { includeArchived: true });

    const { data, error } = await supabase
      .from("flow_stage_fields")
      .insert({
        stage_id: stageId,
        label: trimmedLabel,
        help,
        source,
        sor_field: source === "sor" ? sorField : null,
        field_type: source === "sor" ? "text" : fieldType,
        options: options || [],
        is_required: Boolean(isRequired),
        sort_order: siblings.length,
      })
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "STAGE_FIELD",
      data.id,
      `Field added to stage: "${trimmedLabel}".`,
      { event: "STAGE_FIELD_ADDED", stageId, label: trimmedLabel, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Edits a saved field's label, help text, required flag and (for a
   * custom field) its options — never its source or type, the same "kind
   * fixed once saved" rule `stageConditionService.update` applies to a
   * condition's kind, for the same reason: a value already recorded under
   * one type/source shouldn't be silently reinterpreted.
   */
  async update(id, { label, help, isRequired, options } = {}, actorId) {
    await requireSuperAdmin(actorId);

    const { data: existing, error: fetchError } = await supabase
      .from("flow_stage_fields")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchError) throw fetchError;

    const patch = {};
    if (label !== undefined) {
      const trimmedLabel = (label || "").trim();
      if (!trimmedLabel) throw new Error("A field needs a label.");
      patch.label = trimmedLabel;
    }
    if (help !== undefined) patch.help = help;
    if (isRequired !== undefined) patch.is_required = Boolean(isRequired);
    if (options !== undefined) {
      if (existing.source !== "custom" || existing.field_type !== "choice") {
        throw new Error("Only a custom choice field has options to edit.");
      }
      patch.options = options || [];
    }

    if (Object.keys(patch).length === 0) return existing;

    const { data, error } = await supabase
      .from("flow_stage_fields")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "STAGE_FIELD",
      id,
      `Field updated: "${data.label}".`,
      { event: "STAGE_FIELD_UPDATED", stageId: data.stage_id, label: data.label, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /** Archives a field — soft only, matching `stageConditionService.archive`. */
  async archive(id, actorId) {
    await requireSuperAdmin(actorId);

    const { data, error } = await supabase
      .from("flow_stage_fields")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "STAGE_FIELD",
      id,
      `Field archived: "${data.label}" (${data.stage_id}).`,
      { event: "STAGE_FIELD_ARCHIVED", stageId: data.stage_id, label: data.label, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Un-archives a field, putting it back on the SOR under its Stage — the
   * reverse of `archive`, mirroring `employeeGroupService.restore` and
   * `salesFlowService.restore`. Archiving used to be one-way in the UI, which
   * made removing a field a decision nobody could take back without a direct
   * database write.
   */
  async restore(id, actorId) {
    await requireSuperAdmin(actorId);

    const { data, error } = await supabase
      .from("flow_stage_fields")
      .update({ archived_at: null })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "STAGE_FIELD",
      id,
      `Field restored: "${data.label}" (${data.stage_id}).`,
      { event: "STAGE_FIELD_RESTORED", stageId: data.stage_id, label: data.label, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /** Reorders fields — `updates` is `[{ id, sortOrder }]`, same batch shape as `stageConditionService.reorder`. */
  async reorder(updates, actorId) {
    await requireSuperAdmin(actorId);

    await Promise.all(
      updates.map(async ({ id, sortOrder }) => {
        const { error } = await supabase
          .from("flow_stage_fields")
          .update({ sort_order: sortOrder })
          .eq("id", id);
        if (error) throw error;
      }),
    );

    systemAuditLogService.addSystemEvent(
      "STAGE_FIELD",
      null,
      `Reordered ${updates.length} field(s).`,
      { event: "STAGE_FIELD_REORDERED", updates, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return true;
  },

  /**
   * Saves one Stage Field's value for the SOR's currently-open visit
   * (story 25/26): a custom field writes `sor_stage_field_values`, upserted
   * on the visit+field unique key so re-saving the same field on the same
   * visit updates rather than duplicates. An `sor`-source field is not
   * written here — it writes through the SOR's own single-field save
   * (#199); calling this for one is a caller error.
   */
  async saveValue({ opportunityId, stageVisitId, fieldId, value }, actorId) {
    const { data, error } = await supabase
      .from("sor_stage_field_values")
      .upsert(
        {
          opportunity_id: opportunityId,
          stage_visit_id: stageVisitId,
          field_id: fieldId,
          value,
          updated_by: actorId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stage_visit_id,field_id" },
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** This visit's saved custom field values, keyed by field id — what `missingStageFields`'s `visitValues` argument expects. */
  async getValuesForVisit(stageVisitId) {
    if (!stageVisitId) return {};
    const { data, error } = await supabase
      .from("sor_stage_field_values")
      .select("field_id, value")
      .eq("stage_visit_id", stageVisitId);
    if (error) throw error;

    const byField = {};
    for (const row of data || []) byField[row.field_id] = row.value;
    return byField;
  },
};
