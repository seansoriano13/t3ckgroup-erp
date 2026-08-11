import { supabase } from "../lib/supabase";

export const odooService = {
  /**
   * Looks up the given Sales Reference in Odoo via the odoo-sor-lookup edge
   * function and returns its product lines. Never throws for a "normal" miss
   * (bad format, no match, empty quotation) — those come back as
   * `{ success: false, message }` so the caller can fall back to manual
   * entry instead of surfacing a raw error. Only throws on a transport-level
   * failure (function unreachable, not authenticated).
   */
  async fetchOrderLines(salesReference) {
    const { data, error } = await supabase.functions.invoke("odoo-sor-lookup", {
      body: { salesReference },
    });
    if (error) throw new Error(error.message || "Odoo lookup failed.");
    return data;
  },
};
