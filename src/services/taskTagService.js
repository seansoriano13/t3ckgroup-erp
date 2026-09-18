import { supabase } from "../lib/supabase";

export const TASK_TAG_COLORS = ["mauve", "amber", "blue", "red", "violet", "orange", "green"];

// The unique index on task_tags only covers active rows and is case-insensitive
// (lower(name)) — an expression the fake test database can't evaluate, so this
// check is enforced here rather than relying solely on the DB round-trip.
async function assertNameAvailable(name, excludeId = null) {
  let query = supabase
    .from("task_tags")
    .select("id")
    .is("archived_at", null)
    .ilike("name", name);
  if (excludeId) query = query.neq("id", excludeId);

  const { data, error } = await query;
  if (error) throw error;
  if (data && data.length > 0) {
    throw new Error(`A tag named "${name}" already exists`);
  }
}

export const taskTagService = {
  async list({ includeArchived = false } = {}) {
    let query = supabase.from("task_tags").select("*").order("name", { ascending: true });
    if (!includeArchived) {
      query = query.is("archived_at", null);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create({ name, color, createdBy }) {
    await assertNameAvailable(name);

    const { data, error } = await supabase
      .from("task_tags")
      .insert({ name, color, created_by: createdBy })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async rename(id, name) {
    await assertNameAvailable(name, id);

    const { data, error } = await supabase
      .from("task_tags")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async recolor(id, color) {
    const { data, error } = await supabase
      .from("task_tags")
      .update({ color, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async archive(id) {
    const { data, error } = await supabase
      .from("task_tags")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async restore(id) {
    const { data, error } = await supabase
      .from("task_tags")
      .update({ archived_at: null })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
