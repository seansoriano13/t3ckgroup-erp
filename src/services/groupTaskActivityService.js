import { supabase } from "../lib/supabase";
import { notificationService } from "./notificationService";

export const groupTaskActivityService = {
  async getActivityForTask(taskId) {
    if (!taskId) return [];

    const { data, error } = await supabase
      .from("committee_task_activity")
      .select(`
        *,
        author:employees!committee_task_activity_author_id_fkey(name, is_head, is_hr, is_super_admin, avatar_path)
      `)
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return (data || []).map((entry) => ({
      id: entry.id,
      taskId: entry.task_id,
      authorId: entry.author_id,
      authorName: entry.author?.name || null,
      authorIsHead: entry.author?.is_head || false,
      authorIsHr: entry.author?.is_hr || false,
      authorIsSuperAdmin: entry.author?.is_super_admin || false,
      type: entry.type,
      content: entry.content,
      metadata: entry.metadata,
      createdAt: entry.created_at,
    }));
  },

  /**
   * One page of a task's Chat (its COMMENT entries), oldest first: the `limit`
   * newest strictly older than `before`, or the newest overall when `before`
   * is null. A full page means older ones may remain.
   */
  async getCommentsPage(taskId, { before = null, limit = 30 } = {}) {
    if (!taskId) return [];
    let query = supabase
      .from("committee_task_activity")
      .select(`
        *,
        author:employees!committee_task_activity_author_id_fkey(name, is_head, is_hr, is_super_admin, avatar_path)
      `)
      .eq("task_id", taskId)
      .eq("type", "COMMENT")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (before) query = query.lt("created_at", before);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).reverse().map((entry) => ({
      id: entry.id,
      taskId: entry.task_id,
      authorId: entry.author_id,
      authorName: entry.author?.name || null,
      authorIsHead: entry.author?.is_head || false,
      authorIsHr: entry.author?.is_hr || false,
      authorIsSuperAdmin: entry.author?.is_super_admin || false,
      type: entry.type,
      content: entry.content,
      metadata: entry.metadata,
      createdAt: entry.created_at,
    }));
  },

  /** Every non-COMMENT entry (status changes, approvals…) — few, so never paged. */
  async getEvents(taskId) {
    if (!taskId) return [];
    const { data, error } = await supabase
      .from("committee_task_activity")
      .select(`
        *,
        author:employees!committee_task_activity_author_id_fkey(name, is_head, is_hr, is_super_admin, avatar_path)
      `)
      .eq("task_id", taskId)
      .neq("type", "COMMENT")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((entry) => ({
      id: entry.id,
      taskId: entry.task_id,
      authorId: entry.author_id,
      authorName: entry.author?.name || null,
      authorIsHead: entry.author?.is_head || false,
      authorIsHr: entry.author?.is_hr || false,
      authorIsSuperAdmin: entry.author?.is_super_admin || false,
      type: entry.type,
      content: entry.content,
      metadata: entry.metadata,
      createdAt: entry.created_at,
    }));
  },

  async addComment(taskId, authorId, content, metadata = null) {
    if (!taskId || !authorId) return null;
    const hasContent = content?.trim();
    const hasAttachments = metadata?.attachments?.length > 0;
    if (!hasContent && !hasAttachments) return null;

    const { data, error } = await supabase
      .from("committee_task_activity")
      .insert({
        task_id: taskId,
        author_id: authorId,
        type: "COMMENT",
        content: content?.trim() || "",
        metadata: metadata || null,
      })
      .select(`*, author:employees!committee_task_activity_author_id_fkey(name, is_head, is_hr, is_super_admin, avatar_path)`)
      .single();

    if (error) throw error;

    // Send notifications
    try {
      const { data: ct } = await supabase
        .from("committee_tasks")
        .select("created_by, members:committee_task_members(employee_id)")
        .eq("id", taskId)
        .single();

      const { data: author } = await supabase
        .from("employees")
        .select("name")
        .eq("id", authorId)
        .single();

      const snippet = hasContent
        ? (content.length > 50 ? content.substring(0, 50) + "..." : content)
        : "📷 Sent a photo";

      if (ct) {
        const recipients = new Set();
        if (ct.created_by !== authorId) recipients.add(ct.created_by);
        ct.members?.forEach(m => {
          if (m.employee_id !== authorId) recipients.add(m.employee_id);
        });

        const notifiedSet = new Set();

        if (metadata?.mentions?.length > 0) {
          const uniqueMentionIds = [...new Set(metadata.mentions.map((m) => m.id))];
          uniqueMentionIds.forEach((mentionId) => {
            if (mentionId !== authorId) {
              notificationService.createNotification({
                recipient_id: mentionId,
                sender_id: authorId,
                type: "GROUP_TASK_MENTION",
                title: "You were mentioned in a group task",
                message: `${author?.name || "Someone"} mentioned you: "${snippet}"`,
                reference_id: taskId,
              });
              notifiedSet.add(mentionId);
            }
          });
        }

        for (const recipientId of recipients) {
          if (!notifiedSet.has(recipientId)) {
            notificationService.createNotification({
              recipient_id: recipientId,
              sender_id: authorId,
              type: "GROUP_TASK_COMMENT",
              title: "New Comment on Group Task",
              message: `${author?.name || "Someone"} commented: "${snippet}"`,
              reference_id: taskId,
            });
          }
        }
      }
    } catch (err) {
      console.error("Failed to send comment notification:", err);
    }

    return {
      id: data.id,
      taskId: data.task_id,
      authorId: data.author_id,
      authorName: data.author?.name || null,
      authorIsHead: data.author?.is_head || false,
      authorIsHr: data.author?.is_hr || false,
      authorIsSuperAdmin: data.author?.is_super_admin || false,
      type: data.type,
      content: data.content,
      metadata: data.metadata,
      createdAt: data.created_at,
    };
  },

  async getRecentGroupActivity({
    limit = 50,
    offset = 0,
    type = "ALL",
    authorId = "ALL",
    employeeId = "ALL", // Note: group tasks don't have logged_by in the same way, maybe created_by or member
    taskStatus = "ALL", // HR_PENDING, COMPLETED, etc.
    dateFrom = null,
    dateTo = null,
    search = "",
  } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);

    let query = supabase
      .from("committee_task_activity")
      .select(`
        *,
        task:committee_tasks!committee_task_activity_task_id_fkey(
          id,
          title,
          status,
          created_by,
          created_at,
          creator:employees!committee_tasks_created_by_fkey(name, department, sub_department)
        ),
        author:employees!committee_task_activity_author_id_fkey(name, is_head, is_hr, is_super_admin, avatar_path)
      `)
      .order("created_at", { ascending: false });

    if (type && type !== "ALL") query = query.eq("type", type);
    if (authorId && authorId !== "ALL") {
      if (authorId === "SYSTEM") query = query.is("author_id", null);
      else query = query.eq("author_id", authorId);
    }
    // Simple filter for creator for now if employeeId is specified
    if (employeeId && employeeId !== "ALL") query = query.eq("task.created_by", employeeId);
    if (taskStatus && taskStatus !== "ALL") query = query.eq("task.status", taskStatus);

    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);

    const trimmed = (search || "").trim();
    if (trimmed) {
      const esc = trimmed.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const like = `%${esc}%`;

      const { data: tasksMatch, error: taskSearchErr } = await supabase
        .from("committee_tasks")
        .select("id")
        .ilike("title", like)
        .limit(500);
      
      if (!taskSearchErr) {
        const ids = (tasksMatch || []).map((t) => t.id).filter(Boolean);
        if (ids.length > 0) {
          const inList = ids.join(",");
          query = query.or(`content.ilike.${like},task_id.in.(${inList})`);
        } else {
          query = query.ilike("content", like);
        }
      }
    }

    query = query.range(safeOffset, safeOffset + safeLimit - 1);

    const { data, error } = await query;

    if (error) throw error;

    return (data || []).map((entry) => ({
      id: entry.id,
      taskId: entry.task_id,
      taskDescription: entry.task?.title || null,
      taskStatus: entry.task?.status || null,
      taskLoggedBy: entry.task?.created_by || null,
      taskCreatorName: entry.task?.creator?.name || null,
      taskCreatorDept: entry.task?.creator?.department || null,
      taskCreatorSubDept: entry.task?.creator?.sub_department || null,
      type: entry.type,
      content: entry.content,
      metadata: entry.metadata,
      createdAt: entry.created_at,
      authorId: entry.author_id,
      authorName: entry.author?.name || null,
      authorIsHead: entry.author?.is_head || false,
      authorIsHr: entry.author?.is_hr || false,
      authorIsSuperAdmin: entry.author?.is_super_admin || false,
      isGroup: true,
    }));
  },

  async addSystemEvent(taskId, content, metadata = null) {
    if (!taskId) return;
    try {
      await supabase.from("committee_task_activity").insert({
        task_id: taskId,
        author_id: null,
        type: "SYSTEM",
        content,
        metadata,
      });
    } catch (err) {
      console.error("Failed to log group system event:", err);
    }
  },

  async addApprovalEntry(taskId, authorId, content, metadata = null) {
    if (!taskId) return;
    try {
      await supabase.from("committee_task_activity").insert({
        task_id: taskId,
        author_id: authorId,
        type: "APPROVAL",
        content: content || "",
        metadata,
      });
    } catch (err) {
      console.error("Failed to log group approval entry:", err);
    }
  },

  async addHrEntry(taskId, authorId, content, metadata = null) {
    if (!taskId) return;
    try {
      await supabase.from("committee_task_activity").insert({
        task_id: taskId,
        author_id: authorId,
        type: "HR_NOTE",
        content: content || "Verified",
        metadata,
      });
    } catch (err) {
      console.error("Failed to log group HR entry:", err);
    }
  },

  subscribeToActivity(taskId, onNewEntry, channelSuffix = "") {
    if (!taskId) return null;

    const channelName = `group-task-activity-${taskId}${channelSuffix}`;
    return supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "committee_task_activity",
          filter: `task_id=eq.${taskId}`,
        },
        async (payload) => {
          try {
            if (payload.eventType === "DELETE") {
              onNewEntry({ type: "DELETE" });
              return;
            }

            const { data } = await supabase
              .from("committee_task_activity")
              .select(`*, author:employees!committee_task_activity_author_id_fkey(name, is_head, is_hr, is_super_admin, avatar_path)`)
              .eq("id", payload.new.id)
              .single();

            if (data) {
              onNewEntry({
                id: data.id,
                taskId: data.task_id,
                authorId: data.author_id,
                authorName: data.author?.name || null,
                authorIsHead: data.author?.is_head || false,
                authorIsHr: data.author?.is_hr || false,
                authorIsSuperAdmin: data.author?.is_super_admin || false,
                type: data.type,
                content: data.content,
                metadata: data.metadata,
                createdAt: data.created_at,
              });
            }
          } catch (err) {
            console.error("Failed to hydrate realtime activity entry:", err);
          }
        },
      )
      .subscribe();
  },

  subscribeToAllActivity(onNewEntry) {
    const channelName = `group-task-activity-all-${Math.random().toString(36).substring(7)}`;
    return supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "committee_task_activity",
        },
        async (payload) => {
          try {
            const { data } = await supabase
              .from("committee_task_activity")
              .select(`*, author:employees!committee_task_activity_author_id_fkey(name, is_head, is_hr, is_super_admin, avatar_path)`)
              .eq("id", payload.new.id)
              .single();

            if (data) {
              onNewEntry({
                id: data.id,
                taskId: data.task_id,
                authorId: data.author_id,
                authorName: data.author?.name || null,
                authorIsHead: data.author?.is_head || false,
                authorIsHr: data.author?.is_hr || false,
                authorIsSuperAdmin: data.author?.is_super_admin || false,
                type: data.type,
                content: data.content,
                metadata: data.metadata,
                createdAt: data.created_at,
              });
            }
          } catch (err) {
            console.error("Failed to hydrate realtime activity entry:", err);
          }
        },
      )
      .subscribe();
  },

  unsubscribeFromActivity(channel) {
    if (channel) {
      supabase.removeChannel(channel);
    }
  },
};
