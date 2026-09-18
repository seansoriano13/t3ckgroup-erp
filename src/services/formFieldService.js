import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";
import { FORM_FIELD_TYPES, isCoreFormField, isFormDefaultKey } from "../constants/sorFormBuilder";

/**
 * The registration form's per-flow customization (`flow_form_fields`).
 *
 * Same shape and access model as `stageFieldService`: no direct table access
 * anywhere else, soft archive, an audit line per write. What differs is what
 * a row *means* — see the migration. A row exists only where a built-in
 * default has been changed, or where the flow adds a field of its own, so
 * `restoreDefaults` is a delete rather than a reconciliation.
 *
 * Access control is open, matching every other Flow Canvas service today.
 */
async function requireSuperAdmin(_actorId) {
  // Access control opened: anyone can make changes on Flow Canvas.
}

export const formFieldService = {
  /** Every live customization row for a flow, in sort order. */
  async getForFlow(flowId, { includeArchived = false } = {}) {
    if (!flowId) return [];

    let query = supabase
      .from("flow_form_fields")
      .select("*")
      .eq("flow_id", flowId)
      .order("sort_order", { ascending: true });
    if (!includeArchived) query = query.is("archived_at", null);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * The same rows, found from the Sale Type instead of the flow.
   *
   * The registration form knows which Sale Type was chosen, not which flow
   * owns it, and the two are one-to-one — so resolving it here keeps that
   * join out of the form. An unknown or flow-less Sale Type returns nothing
   * rather than throwing: a Sale Type with no flow yet simply has no
   * customization, and registration against it fails later, for its own
   * clearer reason (`latestSnapshotFor`).
   */
  async getForSaleType(saleTypeId) {
    if (!saleTypeId) return [];

    const { data: flow, error } = await supabase
      .from("sales_flows")
      .select("id")
      .eq("sale_type_id", saleTypeId)
      .maybeSingle();
    if (error) throw error;
    if (!flow) return [];

    return this.getForFlow(flow.id);
  },

  /**
   * Adds a custom field to a flow's registration form. Defaults are never
   * added — they already exist; `customizeDefault` changes one.
   */
  async addCustom({ flowId, label, help = null, fieldType, options = [], isRequired = false }, actorId) {
    await requireSuperAdmin(actorId);

    const trimmedLabel = (label || "").trim();
    if (!trimmedLabel) throw new Error("A field needs a label.");
    if (!FORM_FIELD_TYPES.includes(fieldType)) {
      throw new Error(`Field type must be one of ${FORM_FIELD_TYPES.join(", ")}.`);
    }

    const siblings = await this.getForFlow(flowId, { includeArchived: true });

    const { data, error } = await supabase
      .from("flow_form_fields")
      .insert({
        flow_id: flowId,
        source: "custom",
        default_key: null,
        label: trimmedLabel,
        help,
        field_type: fieldType,
        options: options || [],
        is_required: Boolean(isRequired),
        sort_order: siblings.length,
      })
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_FORM_FIELD",
      data.id,
      `Registration form field added: "${trimmedLabel}".`,
      { event: "FLOW_FORM_FIELD_ADDED", flowId, label: trimmedLabel, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * Customizes one built-in default — its label, help, order, and (unless it
   * is core) whether it is hidden or required. Upserted on
   * `(flow_id, default_key)`, so changing the same default twice edits one row
   * rather than accumulating them.
   */
  async customizeDefault({ flowId, defaultKey, label, help, isHidden, isRequired, sortOrder }, actorId) {
    await requireSuperAdmin(actorId);

    if (!isFormDefaultKey(defaultKey)) {
      throw new Error("That is not a field on the registration form.");
    }
    // The guard the tier exists for. A core field backs a NOT NULL column and
    // is `required` on the form, so hiding it or making it optional produces a
    // form that passes the builder and fails on submit.
    if (isCoreFormField(defaultKey) && (isHidden || isRequired === false)) {
      throw new Error("This field is required to register an SOR — it can be renamed and reordered, but not hidden or made optional.");
    }

    const patch = { flow_id: flowId, source: "default", default_key: defaultKey };
    if (label !== undefined) patch.label = (label || "").trim() || null;
    if (help !== undefined) patch.help = help;
    if (isHidden !== undefined) patch.is_hidden = Boolean(isHidden);
    if (isRequired !== undefined) patch.is_required = Boolean(isRequired);
    if (sortOrder !== undefined) patch.sort_order = sortOrder;

    const { data, error } = await supabase
      .from("flow_form_fields")
      .upsert(patch, { onConflict: "flow_id,default_key" })
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_FORM_FIELD",
      data.id,
      `Registration form default customized: "${defaultKey}".`,
      { event: "FLOW_FORM_FIELD_CUSTOMIZED", flowId, defaultKey, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /** Edits a custom field. Its type is fixed once saved, same rule as a Stage Field. */
  async updateCustom(id, { label, help, isRequired, isHidden, options } = {}, actorId) {
    await requireSuperAdmin(actorId);

    const { data: existing, error: fetchError } = await supabase
      .from("flow_form_fields")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchError) throw fetchError;
    if (existing.source !== "custom") {
      throw new Error("Use customizeDefault to change a built-in field.");
    }

    const patch = {};
    if (label !== undefined) {
      const trimmedLabel = (label || "").trim();
      if (!trimmedLabel) throw new Error("A field needs a label.");
      patch.label = trimmedLabel;
    }
    if (help !== undefined) patch.help = help;
    if (isRequired !== undefined) patch.is_required = Boolean(isRequired);
    if (isHidden !== undefined) patch.is_hidden = Boolean(isHidden);
    if (options !== undefined) {
      if (existing.field_type !== "choice") {
        throw new Error("Only a choice field has options to edit.");
      }
      patch.options = options || [];
    }

    if (Object.keys(patch).length === 0) return existing;

    const { data, error } = await supabase
      .from("flow_form_fields")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_FORM_FIELD",
      id,
      `Registration form field updated: "${data.label}".`,
      { event: "FLOW_FORM_FIELD_UPDATED", flowId: data.flow_id, label: data.label, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /** Reorders the form — `updates` is `[{ id, sortOrder }]`, same batch shape as `stageFieldService.reorder`. */
  async reorder(updates, actorId) {
    await requireSuperAdmin(actorId);

    await Promise.all(
      updates.map(async ({ id, sortOrder }) => {
        const { error } = await supabase
          .from("flow_form_fields")
          .update({ sort_order: sortOrder })
          .eq("id", id);
        if (error) throw error;
      }),
    );

    systemAuditLogService.addSystemEvent(
      "FLOW_FORM_FIELD",
      null,
      `Reordered ${updates.length} registration form field(s).`,
      { event: "FLOW_FORM_FIELD_REORDERED", updates, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return true;
  },

  /** Archives a custom field. A default is never archived — hide it instead. */
  async archiveCustom(id, actorId) {
    await requireSuperAdmin(actorId);

    const { data, error } = await supabase
      .from("flow_form_fields")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_FORM_FIELD",
      id,
      `Registration form field archived: "${data.label}".`,
      { event: "FLOW_FORM_FIELD_ARCHIVED", flowId: data.flow_id, label: data.label, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /** Un-archives a custom field — the reverse of `archiveCustom`. */
  async restoreCustom(id, actorId) {
    await requireSuperAdmin(actorId);

    const { data, error } = await supabase
      .from("flow_form_fields")
      .update({ archived_at: null })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_FORM_FIELD",
      id,
      `Registration form field restored: "${data.label}".`,
      { event: "FLOW_FORM_FIELD_RESTORED", flowId: data.flow_id, label: data.label, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return data;
  },

  /**
   * A registered SOR's custom field answers, keyed by field id.
   *
   * Only ever custom fields: a 'default'-source field wrote the SOR's own
   * column at registration, so its answer is read from the SOR itself.
   */
  async getValuesFor(opportunityId) {
    if (!opportunityId) return {};

    const { data, error } = await supabase
      .from("sor_form_values")
      .select("field_id, value")
      .eq("opportunity_id", opportunityId);
    if (error) throw error;

    const byField = {};
    for (const row of data || []) byField[row.field_id] = row.value;
    return byField;
  },

  /**
   * Writes the custom answers given at registration. `values` maps field id
   * to value; blank answers are skipped rather than stored as empty rows, so
   * "never answered" and "answered with nothing" do not become the same
   * record.
   *
   * Upserted on (opportunity, field) so re-saving edits rather than
   * duplicates — same key shape `stageFieldService.saveValue` uses, minus the
   * Stage Visit a registration answer does not have.
   */
  async saveValues(opportunityId, values = {}, actorId) {
    const rows = Object.entries(values)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([fieldId, value]) => ({
        opportunity_id: opportunityId,
        field_id: fieldId,
        value,
        updated_by: actorId || null,
        updated_at: new Date().toISOString(),
      }));
    if (rows.length === 0) return [];

    const { data, error } = await supabase
      .from("sor_form_values")
      .upsert(rows, { onConflict: "opportunity_id,field_id" })
      .select();
    if (error) throw error;
    return data || [];
  },

  /**
   * Puts the whole form back to the built-in default: deletes every
   * customization row for the flow. This is a hard delete, not an archive,
   * and that is the design — a row means "changed", so removing it *is*
   * restoring. Values already saved against a deleted custom field go with it
   * (`on delete cascade`), which is why the builder confirms first.
   */
  async restoreDefaults(flowId, actorId) {
    await requireSuperAdmin(actorId);

    const { error } = await supabase.from("flow_form_fields").delete().eq("flow_id", flowId);
    if (error) throw error;

    systemAuditLogService.addSystemEvent(
      "FLOW_FORM_FIELD",
      null,
      "Registration form restored to the default.",
      { event: "FLOW_FORM_RESTORED", flowId, employeeId: actorId },
      actorId,
    ).catch(console.error);

    return true;
  },
};
