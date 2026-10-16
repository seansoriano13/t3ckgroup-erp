import { supabase } from "../lib/supabase";

/**
 * The Evaluation of Specification settings (#271, spec #266): the group task template whose
 * tasks call Technical in, and the `evaluation` list of people who approve the evaluation.
 * Every change is a Super Admin's: the database refuses anyone else's write.
 *
 * The template lives in its own one-row table, `costing_evaluation_settings`. The list is the
 * `evaluation` key of `costing_signer_lists`, read as a set of employee ids; saving it adds the
 * people newly picked and removes the ones taken off, nothing else.
 */
export const EVALUATION_LIST_KEY = "evaluation";

export const costingEvaluationSettingsService = {
  /** The template's id, or null when none is set. */
  async getTemplateId() {
    const { data, error } = await supabase.from("costing_evaluation_settings").select("evaluation_template_id").eq("id", true).maybeSingle();
    if (error) throw error;
    return data?.evaluation_template_id ?? null;
  },

  /** The group task templates that can be picked: `{ id, name }`, newest first, archived ones left out. */
  async getTemplates() {
    const { data, error } = await supabase.from("group_task_templates").select("id, name").is("archived_at", null).order("name", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  /** Names the template (or null for none). Creates the single settings row if a database somehow has none. */
  async setTemplateId(templateId) {
    const { data, error } = await supabase
      .from("costing_evaluation_settings")
      .upsert({ id: true, evaluation_template_id: templateId ?? null, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .select("evaluation_template_id");
    if (error) throw error;
    if (!data?.length) throw new Error("The evaluation template could not be saved.");
  },

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
