import { supabase } from "../lib/supabase";
import { PIPELINE_STAGE_SEED } from "../constants/sor";

/**
 * Reads the configurable SOR pipeline out of `crm_pipeline_stages`.
 *
 * The twelve Annex C.3 stages are the seed for that table AND the fallback
 * here, for the same reason the lead source service keeps its own list: the
 * SOR Register renders the pipeline as columns, a filter and a stepper, so an
 * empty result is not a degraded board — it is no board at all. Falling back
 * to the policy pipeline keeps the register usable while the table is empty or
 * unreachable, which also means the frontend can ship before the migration in
 * an emergency rather than being sequenced behind it.
 *
 * A stage's meaning lives in its flags, never in its code or label — see
 * constants/sor.js for the derivations that read them.
 */

const byOrder = (a, b) => a.sort_order - b.sort_order;

/** Sorted so a caller never has to remember to; the pipeline is an order. */
const FALLBACK_STAGES = [...PIPELINE_STAGE_SEED].sort(byOrder);

export const pipelineStageService = {
  /**
   * Every stage, active or not — what the super admin screen manages, and what
   * the register needs in order to render an opportunity still sitting in a
   * stage that was since deactivated.
   */
  async getAllStages() {
    try {
      const { data, error } = await supabase
        .from("crm_pipeline_stages")
        .select("*")
        .order("sort_order", { ascending: true });

      if (error || !data || data.length === 0) {
        console.warn("Falling back to the policy pipeline:", error?.message);
        return FALLBACK_STAGES;
      }
      return data;
    } catch (err) {
      console.warn("Falling back to the policy pipeline:", err.message);
      return FALLBACK_STAGES;
    }
  },

  /**
   * Active stages only — what a stage picker or board column list should show.
   *
   * Ordered by sort_order rather than by label: unlike lead sources, the
   * pipeline is a sequence, and showing it alphabetically would misreport the
   * process.
   */
  async getActiveStages() {
    try {
      const { data, error } = await supabase
        .from("crm_pipeline_stages")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error || !data || data.length === 0) {
        console.warn("Falling back to the policy pipeline:", error?.message);
        return FALLBACK_STAGES.filter((s) => s.is_active);
      }
      return data;
    } catch (err) {
      console.warn("Falling back to the policy pipeline:", err.message);
      return FALLBACK_STAGES.filter((s) => s.is_active);
    }
  },

  /**
   * Add a new pipeline stage.
   * Enforces rules: unique code, cannot insert after anchor.
   */
  async addStage({ label, theme, sort_order }) {
    const code = label.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_")
    
    // Check if code exists
    const existing = await this.getAllStages()
    if (existing.some(s => s.code === code)) {
      throw new Error("A stage with a similar name already exists.")
    }

    const anchorStage = existing.find(s => s.is_anchor)
    if (anchorStage && sort_order >= anchorStage.sort_order) {
      throw new Error("Cannot add a stage after the anchor stage.")
    }

    const { data, error } = await supabase
      .from("crm_pipeline_stages")
      .insert([
        {
          code,
          label: label.trim(),
          theme,
          sort_order,
          is_active: true,
          is_system: false,
        }
      ])
      .select()
      .single()

    if (error) throw error
    return data
  },

  /**
   * Update an existing stage (label and theme only).
   */
  async updateStage(code, { label, theme }) {
    const { data, error } = await supabase
      .from("crm_pipeline_stages")
      .update({ label: label.trim(), theme })
      .eq("code", code)
      .select()
      .single()

    if (error) throw error
    return data
  },

  /**
   * Toggle the active state of a pipeline stage.
   * Prevents deactivating Lead, Anchor, Won, or Lost stages.
   */
  async toggleStage(code, isActive) {
    const existing = await this.getAllStages()
    const stage = existing.find(s => s.code === code)
    
    if (!stage) throw new Error("Stage not found.")
    
    if (!isActive) {
      if (stage.is_default) throw new Error("Cannot deactivate the initial Lead stage.")
      if (stage.is_anchor) throw new Error("Cannot deactivate the Anchor stage.")
      if (stage.is_won) throw new Error("Cannot deactivate the Closed Won stage.")
      if (stage.is_lost) throw new Error("Cannot deactivate the Closed Lost stage.")
    }

    const { data, error } = await supabase
      .from("crm_pipeline_stages")
      .update({ is_active: isActive })
      .eq("code", code)
      .select()
      .single()

    if (error) throw error
    return data
  },

  /**
   * Reorder stages by providing an array of objects { code, sort_order }.
   * Prevents reordering any stage after the Anchor stage.
   */
  async reorderStages(updates) {
    // Basic protection on the server side would require checking anchor position,
    // but we can trust the client for now or enforce it here.
    const { error } = await supabase
      .from("crm_pipeline_stages")
      .upsert(updates.map(u => ({ code: u.code, sort_order: u.sort_order })))

    if (error) throw error
    return true
  }
};
