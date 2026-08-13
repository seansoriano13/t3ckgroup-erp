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

  /**
   * Returns the Odoo customer portal link for the given Sales Reference, so a
   * salesperson can send the quotation as a URL instead of an attachment. The
   * page shows the quotation with every product brochure listed beneath it.
   *
   * Follows the same contract as `fetchOrderLines`: a normal miss comes back
   * as `{ success: false, message }` rather than throwing.
   */
  async fetchShareLink(salesReference) {
    const { data, error } = await supabase.functions.invoke("odoo-quotation-link", {
      body: { salesReference },
    });
    if (error) throw new Error(error.message || "Could not build the quotation link.");
    return data;
  },
};
