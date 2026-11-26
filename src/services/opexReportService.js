import { supabase } from "../lib/supabase";
import { DEFAULT_COST_GROUP } from "../utils/opexReport";

/**
 * OPEX Reports (#1244, spec #1241). The tables are readable only with Finance access or
 * Super Admin; the edge function checks the same. The list reads each report's saved
 * snapshot and never calls Odoo.
 */
export const opexReportService = {
  /** Every report with its last snapshot, newest first. */
  async list() {
    const { data, error } = await supabase
      .from("opex_reports")
      .select("id, s0_number, contract_price, retention, created_at, snapshot:opex_report_snapshots(*)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => ({ ...row, snapshot: Array.isArray(row.snapshot) ? (row.snapshot[0] ?? null) : row.snapshot }));
  },

  async getByS0(s0) {
    const { data, error } = await supabase
      .from("opex_reports")
      .select("id, s0_number, contract_price, retention, created_at")
      .eq("s0_number", s0)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Starts a report for an S0, or returns the one that is already there: `{ report, existed }`. */
  async create(s0) {
    const existing = await this.getByS0(s0);
    if (existing) return { report: existing, existed: true };
    const { data, error } = await supabase.from("opex_reports").insert({ s0_number: s0 }).select().single();
    if (error) {
      if (error.code === "23505") return { report: await this.getByS0(s0), existed: true };
      throw error;
    }
    return { report: data, existed: false };
  },

  /** Reads Odoo for an S0. Throws with the function's own message when it could not. */
  async readFromOdoo(s0, handP0s = []) {
    const { data, error } = await supabase.functions.invoke("odoo-opex-report", { body: { s0, handP0s } });
    if (error) throw new Error(error.message || "Odoo could not be read.");
    if (!data?.success) throw new Error(data?.message || "Odoo could not be read.");
    return data;
  },

  async saveSnapshot(reportId, snapshot) {
    const { error } = await supabase.from("opex_report_snapshots").upsert({ report_id: reportId, ...snapshot });
    if (error) throw error;
  },

  /** Finance's hand edits of one report: { handP0s, typedCosts, linePrices, leftOut }. */
  async getEdits(reportId) {
    const readEditsTable = async (table, order) => {
      const { data, error } = await supabase.from(table).select("*").eq("report_id", reportId).order(order);
      if (error) throw error;
      return data ?? [];
    };
    const [handP0s, typedCosts, linePrices, leftOut] = await Promise.all([
      readEditsTable("opex_report_p0s", "created_at"),
      readEditsTable("opex_typed_costs", "created_at"),
      readEditsTable("opex_line_prices", "created_at"),
      readEditsTable("opex_left_out_expenses", "created_at"),
    ]);
    return { handP0s, typedCosts, linePrices, leftOut };
  },

  /** Contract price or retention typed by Finance; null goes back to Odoo's figure or the rate. */
  async setReportField(reportId, field, value) {
    if (value !== null && !Number.isFinite(Number(value))) throw new Error("The figure is not a number.");
    const { error } = await supabase.from("opex_reports").update({ [field]: value }).eq("id", reportId);
    if (error) throw error;
  },

  /** Asks Odoo whether a P0 exists. Throws with the function's message when Odoo could not be asked. */
  async p0ExistsInOdoo(p0Number) {
    const { data, error } = await supabase.functions.invoke("odoo-opex-report", { body: { checkP0: p0Number } });
    if (error) throw new Error(error.message || "Odoo could not be read.");
    if (!data?.success) throw new Error(data?.message || "Odoo could not be read.");
    return Boolean(data.exists);
  },

  async addP0(reportId, p0Number) {
    const { error } = await supabase.from("opex_report_p0s").insert({ report_id: reportId, p0_number: p0Number });
    if (error && error.code !== "23505") throw error;
  },

  async removeP0(id) {
    const { error } = await supabase.from("opex_report_p0s").delete().eq("id", id);
    if (error) throw error;
  },

  /** Adds a Typed cost, or changes it when `cost.id` is set. */
  async saveTypedCost(reportId, cost) {
    if (!Number.isFinite(Number(cost.amount))) throw new Error("The amount is not a number.");
    const row = {
      cost_date: cost.cost_date || null,
      description: cost.description,
      amount: cost.amount,
      note: cost.note || null,
      cost_group: cost.cost_group || DEFAULT_COST_GROUP,
    };
    const query = cost.id
      ? supabase.from("opex_typed_costs").update(row).eq("id", cost.id)
      : supabase.from("opex_typed_costs").insert({ report_id: reportId, ...row });
    const { error } = await query;
    if (error) throw error;
  },

  async deleteTypedCost(id) {
    const { error } = await supabase.from("opex_typed_costs").delete().eq("id", id);
    if (error) throw error;
  },

  /** A typed unit price for a zero-price P0 line; null clears it. */
  async setLinePrice(reportId, odooLineId, unitPrice) {
    if (unitPrice === null) {
      const { error } = await supabase.from("opex_line_prices").delete().eq("report_id", reportId).eq("odoo_line_id", odooLineId);
      if (error) throw error;
      return;
    }
    if (!Number.isFinite(Number(unitPrice))) throw new Error("The unit price is not a number.");
    const { error } = await supabase
      .from("opex_line_prices")
      .upsert({ report_id: reportId, odoo_line_id: odooLineId, unit_price: unitPrice }, { onConflict: "report_id,odoo_line_id" });
    if (error) throw error;
  },

  /** Leaves an expense out (with an optional note), or puts it back when `leaveOut` is false. */
  async setLeftOut(reportId, analyticLineId, leaveOut, note = null) {
    if (!leaveOut) {
      const { error } = await supabase.from("opex_left_out_expenses").delete().eq("report_id", reportId).eq("analytic_line_id", analyticLineId);
      if (error) throw error;
      return;
    }
    const { error } = await supabase
      .from("opex_left_out_expenses")
      .upsert({ report_id: reportId, analytic_line_id: analyticLineId, note: note || null }, { onConflict: "report_id,analytic_line_id" });
    if (error) throw error;
  },
};
