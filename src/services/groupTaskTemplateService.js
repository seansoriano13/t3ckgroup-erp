import { supabase } from "../lib/supabase";
import { cleanChecklistForSave } from "@/utils/checklist";

export const groupTaskTemplateService = {
  async getTemplates({ includeArchived = false } = {}) {
    let query = supabase
      .from("group_task_templates")
      .select(`
        *,
        members:group_task_template_members(
          id, employee_id, task_description, checklist, role, custom_role, sort_order
        )
      `)
      .order("created_at", { ascending: false });

    if (!includeArchived) query = query.is("archived_at", null);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((t) => ({
      ...t,
      members: [...(t.members || [])].sort((a, b) => a.sort_order - b.sort_order),
    }));
  },

  async getTemplateById(id) {
    const { data, error } = await supabase
      .from("group_task_templates")
      .select(`
        *,
        members:group_task_template_members(
          id, employee_id, task_description, checklist, role, custom_role, sort_order
        )
      `)
      .eq("id", id)
      .single();

    if (error) throw error;
    return {
      ...data,
      members: [...(data.members || [])].sort((a, b) => a.sort_order - b.sort_order),
    };
  },

  async createTemplate(payload) {
    const { name, title, description, dueDateOffsetDays, createdBy, members = [] } = payload;

    if (!name?.trim()) {
      throw new Error("Name your template before saving it.");
    }

    const { data: template, error: templateError } = await supabase
      .from("group_task_templates")
      .insert([
        {
          name: name.trim(),
          title: title || null,
          description: description || null,
          due_date_offset_days: dueDateOffsetDays ?? null,
          created_by: createdBy,
        },
      ])
      .select()
      .single();

    if (templateError) throw templateError;

    if (members.length > 0) {
      const { error: membersError } = await supabase
        .from("group_task_template_members")
        .insert(toMemberPayloads(template.id, members));

      if (membersError) {
        // rollback if needed, same pattern as groupTaskService.createGroupTask
        await supabase.from("group_task_templates").delete().eq("id", template.id);
        throw membersError;
      }
    }

    return template;
  },

  async updateTemplate(id, payload) {
    const { name, title, description, dueDateOffsetDays, members = [] } = payload;

    if (!name?.trim()) {
      throw new Error("Name your template before saving it.");
    }

    const { error: templateError } = await supabase
      .from("group_task_templates")
      .update({
        name: name.trim(),
        title: title || null,
        description: description || null,
        due_date_offset_days: dueDateOffsetDays ?? null,
      })
      .eq("id", id);

    if (templateError) throw templateError;

    // Full replace rather than a diff: nothing else has an FK into a member
    // row's id (only committee_tasks.template_id points at the template
    // itself), so swapping member identity on every edit has no downstream
    // consequence.
    const { error: deleteError } = await supabase
      .from("group_task_template_members")
      .delete()
      .eq("template_id", id);

    if (deleteError) throw deleteError;

    if (members.length > 0) {
      const { error: insertError } = await supabase
        .from("group_task_template_members")
        .insert(toMemberPayloads(id, members));

      if (insertError) throw insertError;
    }

    return true;
  },

  async archiveTemplate(id) {
    const { error } = await supabase
      .from("group_task_templates")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;
    return true;
  },

  async restoreTemplate(id) {
    const { error } = await supabase
      .from("group_task_templates")
      .update({ archived_at: null })
      .eq("id", id);

    if (error) throw error;
    return true;
  },

  async deleteTemplate(id) {
    const { error } = await supabase
      .from("group_task_templates")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return true;
  },

  // { [templateId]: { count, lastUsedAt } }, tallied client-side to match
  // getGroupTasks' existing "fetch small, aggregate in JS" pattern for this
  // same table rather than introducing this codebase's first SQL view.
  async getUsageStats() {
    const { data, error } = await supabase
      .from("committee_tasks")
      .select("template_id, created_at")
      .not("template_id", "is", null);

    if (error) throw error;

    const stats = {};
    for (const row of data) {
      const existing = stats[row.template_id];
      if (!existing) {
        stats[row.template_id] = { count: 1, lastUsedAt: row.created_at };
      } else {
        existing.count += 1;
        if (row.created_at > existing.lastUsedAt) existing.lastUsedAt = row.created_at;
      }
    }
    return stats;
  },
};

function toMemberPayloads(templateId, members) {
  return members.map((m, index) => {
    const rawChecklist = m.checklist;
    const checklist = cleanChecklistForSave(rawChecklist, { resetChecked: true });

    return {
      template_id: templateId,
      employee_id: m.employeeId || m.employee_id || null,
      task_description: (m.taskDescription ?? m.task_description ?? "").trim() || null,
      checklist,
      role: m.role || null,
      custom_role: m.customRole || m.custom_role || null,
      sort_order: index,
    };
  });
}
