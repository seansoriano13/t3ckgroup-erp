import { supabase } from "../lib/supabase";
import { IPAS_ERROR } from "../constants/ipas";
import { ORDER_AGEING_STEPS } from "../constants/orderMonitoring";
import { IpasError } from "./ipasService";
import { INVALID_DAYS_MESSAGE, isValidDays } from "../utils/orderAgeing";

const STEP_KEYS = ORDER_AGEING_STEPS.map((step) => step.key);

/**
 * Order Monitoring (#262, spec #261): the ageing rules Purchasing edits. One
 * rule per step, in days; a step with no rule never goes late. The database
 * decides who may write (Purchasing access and Super Admins) and refuses a
 * step it does not know or a day count below one.
 */
export const orderAgeingRulesService = {
  /**
   * Every step, in track order, with its days or null for no rule. A step with
   * no stored row reads as no rule, so the list is always complete.
   */
  async getRules() {
    const { data, error } = await supabase.from("order_ageing_rules").select("step, days");
    if (error) throw error;
    const daysByStep = new Map((data || []).map((row) => [row.step, row.days ?? null]));
    return STEP_KEYS.map((step) => ({ step, days: daysByStep.get(step) ?? null }));
  },

  /** Sets a step's days, or clears it with null. */
  async setRule(step, days) {
    if (!STEP_KEYS.includes(step)) {
      throw new IpasError(IPAS_ERROR.INVALID, "Pick a step that can have an ageing rule.");
    }
    if (!isValidDays(days)) {
      throw new IpasError(IPAS_ERROR.INVALID, INVALID_DAYS_MESSAGE);
    }
    const { data, error } = await supabase
      .from("order_ageing_rules")
      .upsert({ step, days }, { onConflict: "step" })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
