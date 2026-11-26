import { supabase } from "../lib/supabase";

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
};
