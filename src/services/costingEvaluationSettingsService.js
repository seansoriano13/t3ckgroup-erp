import { supabase } from "../lib/supabase";

/**
 * The Evaluation of Specification settings (#271, spec #266): the `evaluation` list of people who
 * approve the evaluation. Every change is a Super Admin's: the database refuses anyone else's write.
 * (The evaluation task template that once sat beside it is retired: spec #907.)
 *
 * The list is the `evaluation` key of `costing_signer_lists`, read as a set of employee ids; saving
 * it adds the people newly picked and removes the ones taken off, nothing else.
 */
export const EVALUATION_LIST_KEY = "evaluation";

export const costingEvaluationSettingsService = {
  /** The employee ids on the `evaluation` list. */
  async getSigners(listKey = EVALUATION_LIST_KEY) {
    const { data, error } = await supabase.from("costing_signer_lists").select("employee_id").eq("list_key", listKey);
    if (error) throw error;
    return (data ?? []).map((row) => row.employee_id);
  },

  /** Makes the list exactly `employeeIds`: adds the new ones, removes the ones left out. */
  async setSigners(employeeIds, listKey = EVALUATION_LIST_KEY) {
    const wanted = [...new Set(employeeIds ?? [])];
    const have = await this.getSigners(listKey);
    const add = wanted.filter((id) => !have.includes(id));
    const remove = have.filter((id) => !wanted.includes(id));
    if (add.length > 0) {
      const { error } = await supabase.from("costing_signer_lists").insert(add.map((employee_id) => ({ list_key: listKey, employee_id })));
      if (error) throw error;
    }
    if (remove.length > 0) {
      const { error } = await supabase.from("costing_signer_lists").delete().eq("list_key", listKey).in("employee_id", remove);
      if (error) throw error;
    }
  },
};
