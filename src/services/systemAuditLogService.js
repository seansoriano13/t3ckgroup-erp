import { supabase } from "../lib/supabase";

// Entity types considered part of the HR audit trail (employee/category config
// changes, plus every OT/Offset/SIL apply, decision, undo, and withdrawal).
export const HR_ENTITY_TYPES = [
  "EMPLOYEE",
  "CATEGORY",
  "OVERTIME",
  "OFFSET_LEAVE",
  "SIL_LEAVE",
  "LWOP_LEAVE",
  "MEETING_REQUEST",
  "HR_SETTINGS",
];

export const systemAuditLogService = {
  /**
   * Write a system-level admin action to the audit log
   */
  async addSystemEvent(entityType, entityId, content, metadata = null, authorId = null) {
    try {
      await supabase.from("system_audit_logs").insert({
        author_id: authorId || null,
        type: "SYSTEM",
        entity_type: entityType || null,
        entity_id: entityId ? String(entityId) : null,
        content,
        metadata,
      });
    } catch (err) {
      console.error("Failed to log system audit event:", err);
    }
  },

  /**
   * Write an approval-type admin action (e.g. quota published)
   */
  async addApprovalEvent(entityType, entityId, content, metadata = null, authorId = null) {
    try {
      await supabase.from("system_audit_logs").insert({
        author_id: authorId || null,
        type: "APPROVAL",
        entity_type: entityType || null,
        entity_id: entityId ? String(entityId) : null,
        content,
        metadata,
      });
    } catch (err) {
      console.error("Failed to log system approval event:", err);
    }
  },

  /**
   * Paginated feed for the Super Admin Activity Log — SYSTEM tab
   */
  async getRecentSystemActivity({
    limit = 50,
    offset = 0,
    type = "ALL",
    authorId = "ALL",
    employeeId = "ALL",
    entityType = "ALL",
    dateFrom = null,
    dateTo = null,
    search = "",
  } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);

    let query = supabase
      .from("system_audit_logs")
      .select(
        `*, author:employees(name, is_head, is_hr, is_super_admin, avatar_path)`,
      )
      .order("created_at", { ascending: false });

    if (type && type !== "ALL") query = query.eq("type", type);
    if (authorId && authorId !== "ALL") {
      if (authorId === "SYSTEM") query = query.is("author_id", null);
      else query = query.eq("author_id", authorId);
    }
    if (employeeId && employeeId !== "ALL") {
      query = query.eq("metadata->>employeeId", employeeId);
    }
    if (entityType && entityType !== "ALL") query = query.eq("entity_type", entityType);
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);

    const trimmed = (search || "").trim();
    if (trimmed) {
      const esc = trimmed.replace(/%/g, "\\%").replace(/_/g, "\\_");
      query = query.ilike("content", `%${esc}%`);
    }

    query = query.range(safeOffset, safeOffset + safeLimit - 1);

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((entry) => ({
      id: entry.id,
      taskId: entry.entity_id || null,
      taskDescription: entry.entity_type
        ? `[${entry.entity_type}]`
        : "[SYSTEM]",
      taskStatus: null,
      taskCreatorDept: null,
      taskCreatorSubDept: null,
      type: entry.type,
      content: entry.content,
      metadata: entry.metadata,
      createdAt: entry.created_at,
      authorId: entry.author_id,
      authorName: entry.author?.name || null,
      authorIsHead: entry.author?.is_head || false,
      authorIsHr: entry.author?.is_hr || false,
      authorIsSuperAdmin: entry.author?.is_super_admin || false,
      entityType: entry.entity_type,
      entityId: entry.entity_id,
      isSystemLog: true,
    }));
  },

  /**
   * Paginated feed for the HR-specific Logs tab — scoped to HR entity types only
   * (employee/category config changes + OT/Offset/SIL applies, decisions, undos, withdrawals).
   */
  async getRecentHrActivity({
    limit = 50,
    offset = 0,
    type = "ALL",
    authorId = "ALL",
    employeeId = "ALL",
    entityType = "ALL",
    dateFrom = null,
    dateTo = null,
    search = "",
  } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);

    let query = supabase
      .from("system_audit_logs")
      .select(
        `*, author:employees(name, is_head, is_hr, is_super_admin, avatar_path)`,
      )
      .order("created_at", { ascending: false });

    if (entityType && entityType !== "ALL") {
      query = query.eq("entity_type", entityType);
    } else {
      query = query.in("entity_type", HR_ENTITY_TYPES);
    }

    if (type && type !== "ALL") query = query.eq("type", type);
    if (authorId && authorId !== "ALL") {
      if (authorId === "SYSTEM") query = query.is("author_id", null);
      else query = query.eq("author_id", authorId);
    }
    if (employeeId && employeeId !== "ALL") {
      query = query.eq("metadata->>employeeId", employeeId);
    }
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);

    const trimmed = (search || "").trim();
    if (trimmed) {
      const esc = trimmed.replace(/%/g, "\\%").replace(/_/g, "\\_");
      query = query.ilike("content", `%${esc}%`);
    }

    query = query.range(safeOffset, safeOffset + safeLimit - 1);

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((entry) => ({
      id: entry.id,
      type: entry.type,
      content: entry.content,
      metadata: entry.metadata,
      createdAt: entry.created_at,
      authorId: entry.author_id,
      authorName: entry.author?.name || null,
      authorIsHead: entry.author?.is_head || false,
      authorIsHr: entry.author?.is_hr || false,
      authorIsSuperAdmin: entry.author?.is_super_admin || false,
      entityType: entry.entity_type,
      entityId: entry.entity_id,
    }));
  },

  subscribeToAllActivity(onNewEntry) {
    const channelName = `system-audit-all-${Math.random().toString(36).substring(7)}`;
    return supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "system_audit_logs" },
        async (payload) => {
          try {
            const { data } = await supabase
              .from("system_audit_logs")
              .select(
                `*, author:employees(name, is_head, is_hr, is_super_admin, avatar_path)`,
              )
              .eq("id", payload.new.id)
              .single();

            if (data) onNewEntry(data);
          } catch (err) {
            console.error("Failed to hydrate system audit realtime entry:", err);
          }
        },
      )
      .subscribe();
  },

  unsubscribeFromActivity(channel) {
    if (channel) supabase.removeChannel(channel);
  },
};
