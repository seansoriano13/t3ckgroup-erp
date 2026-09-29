import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";

const DEFAULTS = {
  universal_task_submission: true,
  marketing_approval_by_ops_manager: false,
  enable_self_verification: false,
  enable_bulk_approval: false,
  enable_visual_shaming: false,
  retail_storefronts: ["Shopee", "Lazada"],
};

/** Defaults win when the row or a field is missing (null counts as missing). */
function withDefaults(row) {
  const merged = { ...DEFAULTS };
  for (const [k, v] of Object.entries(row ?? {})) {
    if (v !== null && v !== undefined) merged[k] = v;
  }
  return merged;
}

export const appSettingsService = {
  defaults: DEFAULTS,
  withDefaults,

  async getAppSettings() {
    const { data, error } = await supabase
      .from("app_settings")
      .select("*")
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      console.error("Critical error fetching app settings", error);
      throw error;
    }

    return withDefaults(data);
  },

  async updateAppSettings(payload) {
    const { data, error } = await supabase
      .from("app_settings")
      .update(payload)
      .eq("id", true)
      .select()
      .single();
    if (error) throw error;
    systemAuditLogService.addSystemEvent(
      "SETTINGS",
      "app_settings",
      `App settings updated: ${Object.keys(payload).join(", ")}.`,
      { event: "SETTINGS_UPDATED", changes: payload },
    ).catch(console.error);
    return data;
  },
};
