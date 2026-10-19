import { supabase } from "../lib/supabase";
import { IPAS_ERROR } from "../constants/ipas";
import { IpasError } from "./ipasService";
import { DEFAULT_NEAR_DAYS, INVALID_NEAR_DAYS_MESSAGE, isValidNearDays } from "../utils/deliveryDeadline";

/**
 * The client's delivery deadline on Order Monitoring and the Purchasing
 * Dashboard (#467, spec #461). The due date is the database's
 * (`sor_delivery_deadlines`: the SOR's visit to the stage carrying the
 * `deadline` condition, plus its days); N, the days a deadline counts as near,
 * is one row beside the ageing rules that Purchasing edits.
 */
export const deliveryDeadlineService = {
  /**
   * A Map of SOR id to { dueAt, days } for the SORs that have a deadline. An
   * SOR with none is simply absent. The deadline only decorates a page, so a
   * failed read leaves it out rather than hiding the orders.
   */
  async forSors(opportunityIds) {
    const ids = [...new Set((opportunityIds ?? []).filter(Boolean))];
    if (ids.length === 0) return new Map();
    const { data, error } = await supabase.rpc("sor_delivery_deadlines", { p_opportunity_ids: ids });
    if (error) return new Map();
    return new Map((data ?? []).map((row) => [row.opportunity_id, { dueAt: row.due_at, days: row.days }]));
  },

  /** N, the days before the deadline at which an unreceived order is near. Defaults to 5. */
  async getNearDays() {
    const { data, error } = await supabase.from("order_deadline_setting").select("near_days").maybeSingle();
    if (error) throw error;
    return data?.near_days ?? DEFAULT_NEAR_DAYS;
  },

  async setNearDays(days) {
    if (!isValidNearDays(days)) throw new IpasError(IPAS_ERROR.INVALID, INVALID_NEAR_DAYS_MESSAGE);
    const { data, error } = await supabase
      .from("order_deadline_setting")
      .upsert({ id: true, near_days: days }, { onConflict: "id" })
      .select()
      .single();
    if (error) throw error;
    return data.near_days;
  },
};
