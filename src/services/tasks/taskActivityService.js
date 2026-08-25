import { supabase } from "../../lib/supabase";
import { notificationService } from "../notificationService";

export const taskActivityService = {
  /**
   * Fetch all activity entries for a task, joined with author name
   */
  async getActivityForTask(taskId) {
    if (!taskId) return [];

    const { data, error } = await supabase
      .from("task_activity")
      .select(
        `
        *,
        author:employees!task_activity_author_id_fkey(name, is_head, is_hr, is_super_admin, avatar_path)
      `,
      )
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
   * Super Admin: global recent activity feed across all tasks
   */
  async getRecentTaskActivity({
    limit = 50,
    offset = 0,
    type = "ALL",
    authorId = "ALL",
    employeeId = "ALL",
    taskStatus = "ALL",
    dateFrom = null,
    dateTo = null,
    search = "",
  } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);

    let query = supabase
      .from("task_activity")
      .select(
        `
        *,
        task:tasks!task_activity_task_id_fkey(
          id,
          task_description,
          status,
          logged_by,
          created_at,
          creator:employees!tasks_logged_by_fk(name, department, sub_department)
        ),
        author:employees!task_activity_author_id_fkey(name, is_head, is_hr, is_super_admin, avatar_path)
      `,
      )
      .order("created_at", { ascending: false });

    if (type && type !== "ALL") query = query.eq("type", type);
    if (authorId && authorId !== "ALL") {
      if (authorId === "SYSTEM") query = query.is("author_id", null);
      else query = query.eq("author_id", authorId);
    }
    if (employeeId && employeeId !== "ALL") query = query.eq("task.logged_by", employeeId);
    if (taskStatus && taskStatus !== "ALL") query = query.eq("task.status", taskStatus);

    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);

    const trimmed = (search || "").trim();
    if (trimmed) {
      const esc = trimmed.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const like = `%${esc}%`;

      // We cannot OR directly against embedded `task.*` fields in PostgREST.
      // Instead: find matching task IDs, then OR `content` with `task_id in (...)`.
      const { data: tasksMatch, error: taskSearchErr } = await supabase
        .from("tasks")
        .select("id")
        .ilike("task_description", like)
        .limit(500);
      if (taskSearchErr) throw taskSearchErr;

      const ids = (tasksMatch || []).map((t) => t.id).filter(Boolean);
      if (ids.length > 0) {
        // PostgREST expects: task_id.in.(uuid1,uuid2,...)
        const inList = ids.join(",");
        query = query.or(`content.ilike.${like},task_id.in.(${inList})`);
      } else {
        query = query.ilike("content", like);
      }
    }

    query = query.range(safeOffset, safeOffset + safeLimit - 1);

    const { data, error } = await query;

    if (error) throw error;

    return (data || []).map((entry) => ({
      id: entry.id,
      taskId: entry.task_id,
      taskDescription: entry.task?.task_description || null,
      taskStatus: entry.task?.status || null,
      taskLoggedBy: entry.task?.logged_by || null,
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
    }));
  },

  /**
   * Add a human comment to the task timeline
   */
  async addComment(taskId, authorId, content, metadata = null) {
    if (!taskId || !authorId) return null;
    const hasContent = content?.trim();
    const hasAttachments = metadata?.attachments?.length > 0;
    if (!hasContent && !hasAttachments) return null;

    const { data, error } = await supabase
      .from("task_activity")
      .insert({
        task_id: taskId,
        author_id: authorId,
        type: "COMMENT",
        content: content?.trim() || "",
        metadata: metadata || null,
      })
      .select(
        `*, author:employees!task_activity_author_id_fkey(name, is_head, is_hr, is_super_admin, avatar_path)`,
      )
      .single();

    if (error) throw error;

    // Trigger notification to relevant parties
    try {
      const { data: task } = await supabase
        .from("tasks")
        .select("logged_by, reported_to")
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

      if (task) {
        const notifiedSet = new Set();

        if (metadata?.mentions?.length > 0) {
          const uniqueMentionIds = [...new Set(metadata.mentions.map((m) => m.id))];
          uniqueMentionIds.forEach((mentionId) => {
            if (mentionId !== authorId) {
              notificationService.createNotification({
                recipient_id: mentionId,
                sender_id: authorId,
                type: "TASK_MENTION",
                title: "You were mentioned in a task",
                message: `${author?.name || "Someone"} mentioned you: "${snippet}"`,
                reference_id: taskId,
              });
              notifiedSet.add(mentionId);
            }
          });
        }

        // If commenter is the task owner → notify the assigned head
        if (authorId === task.logged_by && task.reported_to && !notifiedSet.has(task.reported_to)) {
          notificationService.createNotification({
            recipient_id: task.reported_to,
            sender_id: authorId,
            type: "TASK_COMMENT",
            title: "New Comment on Task",
            message: `${author?.name || "Someone"} commented: "${snippet}"`,
            reference_id: taskId,
          });
        }
        // If commenter is NOT the task owner → notify the task owner
        else if (authorId !== task.logged_by && !notifiedSet.has(task.logged_by)) {
          notificationService.createNotification({
            recipient_id: task.logged_by,
            sender_id: authorId,
            type: "TASK_COMMENT",
            title: "New Comment on Your Task",
            message: `${author?.name || "A manager"} commented: "${snippet}"`,
            reference_id: taskId,
          });
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

  /**
   * Add a system-generated event to the timeline (called internally by mutations)
   */
  async addSystemEvent(taskId, content, metadata = null) {
    if (!taskId) return;
    try {
      await supabase.from("task_activity").insert({
        task_id: taskId,
        author_id: null,
        type: "SYSTEM",
        content,
        metadata,
      });
    } catch (err) {
      console.error("Failed to log system event:", err);
    }
  },

  /**
   * Generic upsert for activity logs to prevent timeline noise.
   * Finds the most recent log for the task matching the given `type`, `author_id`, and `metadataEvent`.
   * If it exists AND was created within `windowMs` (default 2 hours), updates it.
   * If not, or if it's older than the window, inserts a new one.
   */
  async upsertActivityEntry(taskId, authorId, type, metadataEvent, content, metadata = null, windowMs = 7200000) {
    if (!taskId) return;
    try {
      let query = supabase
        .from("task_activity")
        .select("id, metadata, created_at")
        .eq("task_id", taskId)
        .eq("type", type)
        .eq("metadata->>event", metadataEvent)
        .order("created_at", { ascending: false })
        .limit(1);

      if (authorId === null) {
        query = query.is("author_id", null);
      } else {
        query = query.eq("author_id", authorId);
      }

      const { data: existingLogs } = await query;
      let shouldUpdate = false;
      let existingLog = null;

      if (existingLogs && existingLogs.length > 0) {
        existingLog = existingLogs[0];
        const logTime = new Date(existingLog.created_at).getTime();
        const now = new Date().getTime();
        
        if (now - logTime <= windowMs) {
          shouldUpdate = true;
        }
      }

      if (shouldUpdate) {
        // Preserve the original 'old' value if present, so the diff reflects the entire session
        const newMetadata = {
          ...metadata,
          old: existingLog.metadata?.old !== undefined ? existingLog.metadata.old : metadata?.old,
          new: metadata?.new !== undefined ? metadata.new : metadata?.new,
        };

        await supabase
          .from("task_activity")
          .update({ content, metadata: newMetadata, created_at: new Date().toISOString() })
          .eq("id", existingLog.id);
      } else {
        await supabase.from("task_activity").insert({
          task_id: taskId,
          author_id: authorId,
          type,
          content,
          metadata,
        });
      }
    } catch (err) {
      console.error("Failed to upsert activity entry:", err);
    }
  },

  /**
   * Upsert a checklist event to prevent noise (keeps only one cumulative log)
   */
  async upsertChecklistEvent(taskId, content, metadata = null) {
    return this.upsertActivityEntry(taskId, null, "SYSTEM", "CHECKLIST_UPDATED", content, metadata);
  },

  /**
   * Add a head approval/rejection entry
   */
  async addApprovalEntry(taskId, authorId, content, metadata = null) {
    if (!taskId) return;
    try {
      await supabase.from("task_activity").insert({
        task_id: taskId,
        author_id: authorId,
        type: "APPROVAL",
        content: content || "",
        metadata,
      });
    } catch (err) {
      console.error("Failed to log approval entry:", err);
    }
  },

  /**
   * Add an HR verification/rejection entry
   */
  async addHrEntry(taskId, authorId, content, metadata = null) {
    if (!taskId) return;
    try {
      await supabase.from("task_activity").insert({
        task_id: taskId,
        author_id: authorId,
        type: "HR_NOTE",
        content: content || "Verified",
        metadata,
      });
    } catch (err) {
      console.error("Failed to log HR entry:", err);
    }
  },

  /**
   * Subscribe to real-time activity updates for a task
   */
  subscribeToActivity(taskId, onNewEntry, channelSuffix = "") {
    if (!taskId) return null;

    const channelName = `task-activity-${taskId}${channelSuffix}`;
    return supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_activity",
          filter: `task_id=eq.${taskId}`,
        },
        async (payload) => {
          // Re-fetch with author join since realtime doesn't include joins
          try {
            if (payload.eventType === "DELETE") {
              onNewEntry({ type: "DELETE" });
              return;
            }
            
            const { data } = await supabase
              .from("task_activity")
              .select(
                `*, author:employees!task_activity_author_id_fkey(name, is_head, is_hr, is_super_admin, avatar_path)`,
              )
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

  /**
   * Subscribe to real-time activity updates across ALL tasks
   */
  subscribeToAllActivity(onNewEntry) {
    const channelName = `task-activity-all-${Math.random().toString(36).substring(7)}`;
    return supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "task_activity",
        },
        async (payload) => {
          try {
            const { data } = await supabase
              .from("task_activity")
              .select(
                `*, author:employees!task_activity_author_id_fkey(name, is_head, is_hr, is_super_admin, avatar_path)`,
              )
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

  /**
   * Unsubscribe from real-time activity channel
   */
  unsubscribeFromActivity(channel) {
    if (channel) {
      supabase.removeChannel(channel);
    }
  },
};
