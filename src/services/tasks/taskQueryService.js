import { supabase } from "../../lib/supabase";
import { TASK_STATUS } from "../../constants/status";

/**
 * Backward-compatible field resolution for the checklist/description split.
 *
 * Pre-migration: checklist data lives as JSON in `task_description`.
 * Post-migration: checklist data lives in the dedicated `checklist` column.
 *
 * These helpers ensure the UI works correctly at every stage.
 */
function isJsonString(str) {
  if (typeof str !== "string") return false;
  const trimmed = str.trim();
  return (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  );
}

function resolveChecklist(taskDescription, checklistColumn) {
  // Prefer the dedicated column
  if (checklistColumn) return checklistColumn;
  // Fall back: legacy JSON stored in task_description
  if (taskDescription && isJsonString(taskDescription)) {
    try {
      const parsed = JSON.parse(taskDescription.trim());
      // Array format: [{text, checked}, ...]
      if (Array.isArray(parsed)) return parsed;
      // Object format: {title, items: [...]}
      if (parsed && Array.isArray(parsed.items)) return parsed;
    } catch { /* not valid JSON */ }
  }
  return null;
}

function resolveDescription(taskDescription, checklistColumn) {
  // If the checklist column is populated, task_description is clean text
  if (checklistColumn) return taskDescription || "";
  // Pre-migration: if task_description is JSON, it's checklist data — not a description
  if (taskDescription && isJsonString(taskDescription)) return "";
  return taskDescription || "";
}

const extractSubmittedByName = (activityLogs = [], fallbackName = null) => {
  if (!Array.isArray(activityLogs) || activityLogs.length === 0) return fallbackName;

  const createdLog = activityLogs.find((log) => {
    if (!log) return false;
    const event = log?.metadata?.event;
    const content = log?.content || "";
    return event === "TASK_CREATED" || content.startsWith("Task submitted by ");
  });

  if (!createdLog) return fallbackName;

  if (createdLog?.metadata?.submittedByName) {
    return createdLog.metadata.submittedByName;
  }

  const content = createdLog?.content || "";
  const match = content.match(/^Task submitted by (.+?)\.(?:\s+Reported to:.*)?$/);
  return match?.[1] || fallbackName;
};

export const taskQueryService = {
  // 1. HR/HEAD VIEW: Get everything
  async getAllTasks({ from = null, to = null } = {}) {
    let query = supabase
      .from("tasks")
      .select(
        `
        *,
        creator:employees!tasks_logged_by_fk(name, department, sub_department, email, is_super_admin, avatar_path),
        editor:employees!tasks_edited_by_fk(name, avatar_path),
        evaluator:employees!tasks_evaluated_by_fkey(name, avatar_path),
        reportedToHead:employees!tasks_reported_to_fkey(name, avatar_path),
        opportunity:sales_opportunities(client_name, sales_reference),
        categories(description)
      `,
      )
      .neq("status", TASK_STATUS.DELETED)
      .order("created_at", { ascending: false });

    if (Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from) {
      query = query.range(from, to);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data.map((task) => ({
      id: task.id,
      taskDescription: resolveDescription(task.task_description, task.checklist),
      checklist: resolveChecklist(task.task_description, task.checklist),
      projectTitle: task.project_title || null,
      opportunityId: task.opportunity_id || null,
      opportunity: task.opportunity || null,
      categoryId: task.category_id,
      categoryDesc: task.categories?.description,
      loggedById: task.logged_by,
      loggedByName: task.creator?.name,
      loggedByAvatar: task.creator?.avatar_path,
      loggedByEmail: task.creator?.email,
      submittedByName: task.creator?.name,
      creator: task.creator,
      editedById: task.edited_by || null,
      editedByName: task.editor?.name || null,
      editedByAvatar: task.editor?.avatar_path || null,
      editedAt: task.edited_at || null,
      evaluatedById: task.evaluated_by || null,
      evaluatedByName: task.evaluator?.name || null,
      evaluatedByAvatar: task.evaluator?.avatar_path || null,
      evaluatedAt: task.evaluated_at || null,
      reportedTo: task.reported_to,
      reportedToName: task.reportedToHead?.name || null,
      reportedToAvatar: task.reportedToHead?.avatar_path || null,
      startAt: task.start_at,
      endAt: task.end_at,
      status: task.status,
      priority: task.priority,
      remarks: task.remarks || "",
      hrRemarks: task.hr_remarks || "",
      grade: task.grade || 0,
      hrVerifiedAt: task.hr_verified_at || null,
      hrVerified: task.hr_verified,
      paymentVoucher: task.payment_voucher || "",
      attachments: task.attachment_urls || [],
      createdAt: task.created_at,
    }));
  },

  // 2. EMPLOYEE VIEW: Get only tasks logged by the current user
  async getMyTasks(userId, { from = null, to = null } = {}) {
    let query = supabase
      .from("tasks")
      .select(
        `
        *,
        creator:employees!tasks_logged_by_fk(name, department, sub_department, email, avatar_path),
        editor:employees!tasks_edited_by_fk(name, avatar_path),
        evaluator:employees!tasks_evaluated_by_fkey(name, avatar_path),
        reportedToHead:employees!tasks_reported_to_fkey(name, avatar_path),
        opportunity:sales_opportunities(client_name, sales_reference),
        categories(description)
      `,
      )
      .eq("logged_by", userId)
      .neq("status", TASK_STATUS.DELETED)
      .order("created_at", { ascending: false });

    if (Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from) {
      query = query.range(from, to);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data.map((task) => ({
      id: task.id,
      taskDescription: resolveDescription(task.task_description, task.checklist),
      checklist: resolveChecklist(task.task_description, task.checklist),
      projectTitle: task.project_title || null,
      opportunityId: task.opportunity_id || null,
      opportunity: task.opportunity || null,
      categoryId: task.category_id,
      categoryDesc: task.categories?.description,
      loggedById: task.logged_by,
      loggedByName: task.creator?.name,
      loggedByAvatar: task.creator?.avatar_path,
      submittedByName: task.creator?.name,
      creator: task.creator,
      editedById: task.edited_by || null,
      editedByName: task.editor?.name || null,
      editedByAvatar: task.editor?.avatar_path || null,
      editedAt: task.edited_at || null,
      evaluatedById: task.evaluated_by || null,
      evaluatedByName: task.evaluator?.name || null,
      evaluatedByAvatar: task.evaluator?.avatar_path || null,
      evaluatedAt: task.evaluated_at || null,
      reportedTo: task.reported_to,
      reportedToName: task.reportedToHead?.name || null,
      reportedToAvatar: task.reportedToHead?.avatar_path || null,
      startAt: task.start_at,
      endAt: task.end_at,
      status: task.status,
      priority: task.priority,
      remarks: task.remarks || "",
      hrRemarks: task.hr_remarks || "",
      hrVerified: task.hr_verified,
      hrVerifiedAt: task.hr_verified_at || null,
      grade: task.grade || 0,
      paymentVoucher: task.payment_voucher || "",
      attachments: task.attachment_urls || [],
      createdAt: task.created_at,
    }));
  },

  // 2.3. MANAGER REPLIES: Fetch all task IDs where the current user has any activity entry
  async getManagerRepliesForTasks(taskIds, userId) {
    if (!taskIds?.length || !userId) return new Set();
    const { data, error } = await supabase
      .from("task_activity")
      .select("task_id")
      .in("task_id", taskIds)
      .eq("author_id", userId);
    if (error) throw error;
    return new Set((data || []).map((r) => r.task_id));
  },

  // 2.5. SINGLE FETCH: Get one task by ID (for deep linking)
  async getTaskById(taskId) {
    const { data, error } = await supabase
      .from("tasks")
      .select(
        `
        *, 
        creator:employees!tasks_logged_by_fk(name, department, sub_department, email, is_super_admin, avatar_path),
        editor:employees!tasks_edited_by_fk(name, avatar_path),
        opportunity:sales_opportunities(client_name, sales_reference),
        evaluator:employees!tasks_evaluated_by_fkey(name, avatar_path),
        reportedToHead:employees!tasks_reported_to_fkey(name, avatar_path),
        activityLogs:task_activity!task_activity_task_id_fkey(content, metadata, created_at),
        categories(description)
      `,
      )
      .eq("id", taskId)
      .single();

    if (error) throw error;

    return {
      id: data.id,
      taskDescription: resolveDescription(data.task_description, data.checklist),
      checklist: resolveChecklist(data.task_description, data.checklist),
      projectTitle: data.project_title || null,
      opportunityId: data.opportunity_id || null,
      opportunity: data.opportunity || null,
      categoryId: data.category_id,
      categoryDesc: data.categories?.description,
      loggedById: data.logged_by,
      loggedByName: data.creator?.name,
      loggedByAvatar: data.creator?.avatar_path,
      loggedByEmail: data.creator?.email,
      submittedByName: extractSubmittedByName(data.activityLogs, data.creator?.name),
      creator: data.creator,
      editedById: data.edited_by,
      editedByName: data.editor?.name,
      editedByAvatar: data.editor?.avatar_path,
      editedAt: data.edited_at,
      evaluatedById: data.evaluated_by,
      evaluatedByName: data.evaluator?.name,
      evaluatedByAvatar: data.evaluator?.avatar_path,
      evaluatedAt: data.evaluated_at,
      reportedTo: data.reported_to,
      reportedToName: data.reportedToHead?.name || null,
      reportedToAvatar: data.reportedToHead?.avatar_path || null,
      startAt: data.start_at,
      endAt: data.end_at,
      status: data.status,
      priority: data.priority,
      remarks: data.remarks,
      hrRemarks: data.hr_remarks,
      grade: data.grade,
      hrVerified: data.hr_verified,
      hrVerifiedAt: data.hr_verified_at,
      paymentVoucher: data.payment_voucher,
      attachments: data.attachment_urls || [],
      createdAt: data.created_at,
    };
  },
};
