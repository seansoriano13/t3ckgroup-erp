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
};
