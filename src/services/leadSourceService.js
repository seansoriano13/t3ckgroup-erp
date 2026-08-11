import { supabase } from "../lib/supabase";

export const leadSourceService = {
  /**
   * Fetch all lead sources (both active and inactive).
   * Typically used for admin/settings management.
   */
  async getAllLeadSources() {
    const { data, error } = await supabase
      .from("crm_lead_sources")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data;
  },

  /**
   * Fetch only active lead sources.
   * Used for populating dropdowns when creating/editing opportunities.
   */
  async getActiveLeadSources() {
    const { data, error } = await supabase
      .from("crm_lead_sources")
      .select("*")
      .eq("is_active", true)
      .order("label", { ascending: true });

    if (error) throw error;
    return data;
  },

  /**
   * Add a new lead source.
   * @param {Object} payload { value: string, label: string }
   */
  async addLeadSource(payload) {
    if (!payload.value || !payload.label) {
      throw new Error("Both Value and Label are required.");
    }

    const { data, error } = await supabase
      .from("crm_lead_sources")
      .insert([
        {
          value: payload.value.trim().toUpperCase(),
          label: payload.label.trim(),
          is_active: true,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Toggle the active state of a lead source.
   * @param {string} value The lead source value (ID).
   * @param {boolean} isActive The new active state.
   */
  async toggleLeadSource(value, isActive) {
    const { data, error } = await supabase
      .from("crm_lead_sources")
      .update({ is_active: isActive })
      .eq("value", value)
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};
