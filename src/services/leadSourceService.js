import { supabase } from "../lib/supabase";

const FALLBACK_LEAD_SOURCES = [
  { value: 'LGU', label: 'LGU', is_active: true },
  { value: 'NGA', label: 'NGA', is_active: true },
  { value: 'GOCC', label: 'GOCC', is_active: true },
  { value: 'BFP', label: 'BFP', is_active: true },
  { value: 'PNP', label: 'PNP', is_active: true },
  { value: 'MIL', label: 'MIL', is_active: true },
  { value: 'DRRM', label: 'DRRM', is_active: true },
  { value: 'CORPORATE', label: 'Corporate', is_active: true },
  { value: 'REFERRAL', label: 'Referral', is_active: true },
  { value: 'WEBSITE', label: 'Website', is_active: true },
  { value: 'FACEBOOK', label: 'Facebook', is_active: true },
  { value: 'TIKTOK', label: 'TikTok', is_active: true },
  { value: 'SHOPEE', label: 'Shopee', is_active: true },
  { value: 'LAZADA', label: 'Lazada', is_active: true },
  { value: 'EXHIBITION', label: 'Exhibition', is_active: true },
  { value: 'REPEAT_CLIENT', label: 'Repeat Client', is_active: true },
];

export const leadSourceService = {
  /**
   * Fetch all lead sources (both active and inactive).
   * Typically used for admin/settings management.
   */
  async getAllLeadSources() {
    try {
      const { data, error } = await supabase
        .from("crm_lead_sources")
        .select("*")
        .order("created_at", { ascending: true });

      if (error || !data || data.length === 0) {
        console.warn("Falling back to default lead sources:", error?.message);
        return FALLBACK_LEAD_SOURCES;
      }
      return data;
    } catch (err) {
      console.warn("Falling back to default lead sources:", err.message);
      return FALLBACK_LEAD_SOURCES;
    }
  },

  /**
   * Fetch only active lead sources.
   * Used for populating dropdowns when creating/editing opportunities.
   */
  async getActiveLeadSources() {
    try {
      const { data, error } = await supabase
        .from("crm_lead_sources")
        .select("*")
        .eq("is_active", true)
        .order("label", { ascending: true });

      if (error || !data || data.length === 0) {
        console.warn("Falling back to default active lead sources:", error?.message);
        return FALLBACK_LEAD_SOURCES.filter(s => s.is_active);
      }
      return data;
    } catch (err) {
      console.warn("Falling back to default active lead sources:", err.message);
      return FALLBACK_LEAD_SOURCES.filter(s => s.is_active);
    }
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
