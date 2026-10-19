import { supabase } from "../lib/supabase";

/**
 * The Purchasing Dashboard (#322). The database works out the groups and
 * decides who may read them (Purchasing access, Finance access, Super Admins);
 * this only fetches the rows and the names behind their Buyer and Canvasser ids.
 * No money is ever sent.
 */
export const purchasingDashboardService = {
  async rows() {
    const { data, error } = await supabase.rpc("purchasing_dashboard_rows");
    if (error) throw error;
    return data ?? [];
  },

  /** Names for the Buyer and Canvasser filters, keyed by employee id. */
  async names(ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return {};
    const { data, error } = await supabase.from("employees").select("id, name").in("id", unique);
    if (error) throw error;
    return Object.fromEntries((data ?? []).map((row) => [row.id, row.name]));
  },
};
