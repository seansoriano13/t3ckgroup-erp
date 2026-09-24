import { FileInput } from "@/components/ui/FileInput";
import { ExternalLink } from "@/components/ui/external-link";
import { buildReplySnapshot } from "../utils/chatReply";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { notificationService } from "../services/notificationService";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { taskActivityService } from "../services/tasks/taskActivityService";
import { groupTaskActivityService } from "../services/groupTaskActivityService";
import { activeChatService } from "../services/tasks/activeChatService";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { useEmployeeAvatarMap } from "../hooks/useEmployeeAvatarMap";
import { useFileAttachments } from "../hooks/useFileAttachments";
import { ALLOWED_MIME_TYPES } from "../utils/attachments";
import {
  Send,
  Zap,
  MessageCircle,
  ShieldCheck,
  Star,
  AlertTriangle,
  Clock,
  Paperclip,
  ImageIcon,
  X,
  Reply,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Spinner from "@/components/ui/Spinner";
import Avatar from "./Avatar";
import TabGroup from "./ui/TabGroup";
import HistoryTimeline from "./HistoryTimeline";
import MentionTextarea from "./ui/MentionTextarea";
import { employeeService } from "../services/employeeService";
import EmojiPicker from "./ui/EmojiPicker";
import ReplyPreviewBar from "./ui/ReplyPreviewBar";
import ReplyQuote from "./ui/ReplyQuote";
import SwipeToReplyWrapper from "./ui/SwipeToReplyWrapper";
import { AttachmentList, AttachmentPreviews } from "./ui/Attachments";

/**
 * Splits text into plain-text segments and URL segments,
 * rendering URLs as clickable <a> tags.
 */
function renderContent(text, messageMentions = [], isMe = false) {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const names = (messageMentions || []).map((m) => m.name).filter(Boolean);
  const escaped = names.length > 0 ? names.slice().sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") : null;
  const mentionRegex = escaped ? new RegExp(`(@(?:${escaped}))`, "g") : null;

  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (urlRegex.test(part)) {
      return (
        <ExternalLink
          key={`url-${i}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 opacity-90 hover:opacity-100 break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </ExternalLink>
      );
    } else if (mentionRegex) {
      const mParts = part.split(mentionRegex);
      return mParts.map((mPart, j) => {
        if (/^@/.test(mPart) && names.some((n) => `@${n}` === mPart)) {
          return (
            <span
              key={`mention-${i}-${j}`}
              className={`rounded px-1 font-semibold ${isMe ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/20 text-primary/90"}`}
            >
              {mPart}
            </span>
          );
        }
        return <span key={`text-${i}-${j}`}>{mPart}</span>;
      });
    }
    return <span key={`text-${i}`}>{part}</span>;
  });
}

const formatTime = (isoString) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

/**
 * Renders a single activity entry based on its type
 */
function ActivityEntry({ entry, currentUserId, avatarMap, onReply, onReact }) {
  const isMe = entry.authorId === currentUserId;

  const reactions = entry.metadata?.reactions || {};
  const hasReactions = Object.keys(reactions).length > 0;

  // --- COMMENT (Human message) ---
  return (
    <div className={`flex gap-2.5 group ${isMe ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <Avatar
        name={entry.authorName}
        src={avatarMap.get(entry.authorId) ?? undefined}
        className={`w-9 h-9 text-xs font-black border rounded-full ${entry.authorIsHead || entry.authorIsSuperAdmin
          ? "bg-warning/15 text-amber-9 border-amber-500/30"
          : entry.authorIsHr
            ? "bg-blue-9/15 text-blue-9 border-blue-500/30"
            : "bg-muted/50 text-mauve-10 border-border"
          }`}
      />

      {/* Bubble */}
      <div className={`max-w-[85%] min-w-0 relative flex flex-col ${isMe ? "items-end" : "items-start"}`}>
        <div className="flex items-center gap-2 mb-1 px-1">
          {!isMe && (
            <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-widest">
              {entry.authorName}
            </span>
          )}
          {isMe && (
            <span className="text-[10px] font-extrabold text-mauve-11  uppercase tracking-widest ml-auto">
              You
            </span>
          )}
        </div>

        <div className="relative flex items-center gap-2 min-w-0 max-w-full">
          {/* Hover Actions (Reply, React) */}
          <div className={`hidden md:flex absolute top-1/2 -translate-y-1/2 transition-opacity z-10 items-center gap-1 opacity-0 group-hover:opacity-100 ${isMe ? "right-full mr-2 flex-row-reverse" : "left-full ml-2 flex-row"}`}>
            <div className="bg-card border border-border shadow-sm rounded-full p-1 flex items-center justify-center">
              <EmojiPicker
                onSelect={(emoji) => onReact?.(entry, emoji)}
                align={isMe ? "start" : "end"}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onReply?.(entry)}
              className="h-auto w-auto bg-card border-border shadow-sm rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted md:hidden"
            >
              <Reply size={14} />
            </Button>
          </div>

          <SwipeToReplyWrapper 
            isMe={isMe} 
            onReply={() => onReply?.(entry)}
            onReact={(emoji) => onReact?.(entry, emoji)}
          >
            <div
              className={`px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm transition-all duration-300 whitespace-pre-wrap break-words min-w-0 ${isMe
                ? "bg-primary text-primary-foreground rounded-tr-none"
                : "bg-card text-foreground rounded-tl-none border border-border"
                }`}
              style={{ wordBreak: "break-word" }}
            >
              <ReplyQuote replyTo={entry.metadata?.replyTo} />
              {entry.content && <p>{renderContent(entry.content, entry.metadata?.mentions, isMe)}</p>}
              {entry.metadata?.attachments?.length > 0 && (
                <AttachmentList 
                  attachments={entry.metadata.attachments} 
                  className={entry.content ? "mt-2" : ""} 
                />
              )}
            </div>
          </SwipeToReplyWrapper>
        </div>

        {/* Reaction Badges */}
        {hasReactions && (
          <div className={`flex flex-wrap gap-1 mt-1 z-10 ${isMe ? "justify-end" : "justify-start"}`}>
            {Object.entries(reactions).map(([emoji, users]) => {
              const iReacted = users.includes(currentUserId);
              return (
                <Button
                  key={emoji}
                  variant="outline"
                  onClick={() => onReact && onReact(entry, emoji)}
                  className={`h-auto flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-card hover:bg-muted transition-colors ${iReacted ? "border-primary text-primary bg-primary/10 hover:bg-primary/10" : "border-border text-muted-foreground"}`}
                >
                  <span>{emoji}</span>
                  <span>{users.length}</span>
                </Button>
              );
            })}
          </div>
        )}

        <div className={`flex items-center gap-1 mt-1 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
          <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest px-1">
            {formatTime(entry.createdAt)}
          </span>
          {/* Read Receipts Avatars */}
          {entry.seenBy?.length > 0 && (
            <div className={`flex items-center gap-0.5 ${isMe ? "mr-1" : "ml-1"}`}>
              {entry.seenBy.map(u => (
                <Avatar
                  key={u.id}
                  name={u.name || "?"}
                  src={u.src}
                  size="xs"
                  className="w-3.5 h-3.5 text-[7px]"
                  title={`Seen by ${u.name}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Legacy remarks renderer — shown for old tasks that have remarks/hr_remarks
 * but no activity entries yet.
 */
function LegacyEntries({ remarks, hrRemarks, evaluatedByName, grade }) {
  if (!remarks && !hrRemarks) return null;

  return (
    <div className="space-y-2 pb-3 mb-3 border-b border-border border-dashed">
      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest px-1">
        Legacy Record
      </p>
      {remarks && (
        <div className="py-2 px-3 rounded-lg bg-muted/50/50 border border-border">
          <div className="flex items-center gap-2 mb-1">
            <Star size={10} className="text-amber-9" />
            <span className="text-[10px] font-bold text-muted-foreground">
              {evaluatedByName || "Manager"} {grade ? `— Grade: ${grade}` : ""}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {remarks}
          </p>
        </div>
      )}
      {hrRemarks && (
        <div className="py-2 px-3 rounded-lg bg-blue-9/5 border border-blue-500/15">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={10} className="text-blue-9" />
            <span className="text-[10px] font-bold text-muted-foreground">
              HR Notes
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {hrRemarks}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * TaskActivityTimeline — The unified activity feed for a task.
 * Shows system events, comments, approvals, and HR notes in one chronological view.
 */
export default function TaskActivityTimeline({
  taskId,
  entityType = "TASK",
  legacyRemarks,
  legacyHrRemarks,
  evaluatedByName,
  grade,
  disabled = false,
  inputType = "textarea",
  isSplitScreen = false,
}) {
  const { user } = useAuth();
  const avatarMap = useEmployeeAvatarMap();
  const queryClient = useQueryClient();
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const [message, setMessage] = useState("");
  const [mentions, setMentions] = useState([]);
  
  const attachmentsState = useFileAttachments();
  const { 
    files: attachments, 
    isUploading, 
    addFiles,
    addFromPaste, 
    removeFile: removeAttachment, 
    clear: clearAttachments, 
    upload: uploadAttachments 
  } = attachmentsState;

  const [replyingTo, setReplyingTo] = useState(null);
  const [activeTab, setActiveTab] = useState("ACTIVITY");

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
    enabled: true,
    staleTime: 5 * 60 * 1000,
  });

  const instanceId = useRef(
    `-timeline-${Math.random().toString(36).substring(2, 9)}`,
  );

  // Fetch activity
  const { data: activity = [], isLoading } = useQuery({
    queryKey: ["taskActivity", taskId, entityType],
    queryFn: () =>
      entityType === "GROUP_TASK"
        ? groupTaskActivityService.getActivityForTask(taskId)
        : taskActivityService.getActivityForTask(taskId),
    enabled: !!taskId,
    staleTime: 30_000,
  });

  const comments = useMemo(
    () => activity.filter(e => e.type === "COMMENT"),
    [activity],
  );
  const history = useMemo(
    () => activity.filter(e => e.type !== "COMMENT"),
    [activity],
  );

  // Stable primitive for the auto-bump effect below: the array identity changes
  // on every render, the timestamp only when the thread actually moves.
  const latestCommentAt =
    comments.length > 0 ? comments[comments.length - 1].createdAt : null;

  // Read Receipts
  const { data: readReceipts = [] } = useQuery({
    queryKey: ["chatReadReceipts", entityType, taskId],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_read_receipts")
        .select("user_id, last_read_at")
        .eq("entity_type", entityType)
        .eq("entity_id", String(taskId));
      return data || [];
    },
    enabled: !!taskId,
  });

  // Seen By Calculation
  const commentsWithSeenBy = useMemo(() => {
    if (!comments || comments.length === 0) return [];
    const userToLastSeenMsgId = {};
    for (const receipt of readReceipts) {
      if (receipt.user_id === user?.id) continue;

      const readAt = new Date(receipt.last_read_at).getTime();
      let latestMsg = null;
      for (const m of comments) {
        if (new Date(m.createdAt).getTime() <= readAt) {
          if (!latestMsg || new Date(m.createdAt).getTime() > new Date(latestMsg.createdAt).getTime()) {
            latestMsg = m;
          }
        }
      }
      if (latestMsg) {
        // Prevent showing someone's read receipt on their OWN message
        // Usually you only care about who read YOUR messages (or other people's),
        // not that a person read their own message.
        if (latestMsg.authorId === receipt.user_id) {
          // If the latest message they read is their own, find the latest message BEFORE it that is NOT theirs
          let latestNotTheirs = null;
          for (const m of comments) {
            if (new Date(m.createdAt).getTime() <= readAt && m.authorId !== receipt.user_id) {
              if (!latestNotTheirs || new Date(m.createdAt).getTime() > new Date(latestNotTheirs.createdAt).getTime()) {
                latestNotTheirs = m;
              }
            }
          }
          if (latestNotTheirs) latestMsg = latestNotTheirs;
          else latestMsg = null; // Don't show receipt if they only read their own messages and nothing else exists
        }
        
        if (latestMsg) {
          if (!userToLastSeenMsgId[latestMsg.id]) userToLastSeenMsgId[latestMsg.id] = [];
          
          // Try to get name from employees, fallback to looking through comments for authorName
          const emp = employees.find(e => e.id === receipt.user_id);
          let name = emp?.name;
          if (!name) {
            const commentByThem = comments.find(c => c.authorId === receipt.user_id);
            name = commentByThem ? commentByThem.authorName : "Unknown";
          }
          
          userToLastSeenMsgId[latestMsg.id].push({
            id: receipt.user_id,
            name: name,
            src: avatarMap.get(receipt.user_id)
          });
        }
      }
    }
    return comments.map(m => ({ ...m, seenBy: userToLastSeenMsgId[m.id] || [] }));
  }, [comments, readReceipts, user, employees, avatarMap]);

  // Real-time listener for read receipts
  useEffect(() => {
    if (!taskId) return;
    const channel = supabase
      .channel(`read-receipts-${taskId}-timeline`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_read_receipts",
          filter: `entity_id=eq.${taskId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["chatReadReceipts", entityType, taskId],
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [taskId, entityType, queryClient]);

  const { mutate: markAsRead } = useMutation({
    mutationFn: ({ entityType, entityId, latestCreatedAt }) =>
      activeChatService.markAsRead(user?.id, entityType, entityId, latestCreatedAt),
  });

  // Auto-bump read receipts.
  // Every dependency here must be a primitive or a stable callback. Depending on
  // the `comments` array or the whole mutation object made this effect re-run on
  // every render: each run upserted a receipt, the realtime listener above saw
  // its own write and invalidated the receipts query, that re-rendered, and the
  // effect fired again -- an unbounded POST/GET loop that exhausted the browser's
  // connection pool (ERR_INSUFFICIENT_RESOURCES) and took unrelated requests
  // down with it. `mutate` is referentially stable in react-query v5.
  useEffect(() => {
    // Waiting for the thread to load keeps this to a single upsert per open:
    // bumping while `activity` is still empty writes a receipt that the real
    // latest-comment timestamp immediately overwrites.
    if (!taskId || !user?.id || isLoading) return;
    markAsRead({
      entityType,
      entityId: taskId,
      latestCreatedAt: latestCommentAt ?? new Date().toISOString(),
    });
  }, [taskId, user?.id, entityType, latestCommentAt, isLoading, markAsRead]);

  // Post comment mutation
  const postCommentMutation = useMutation({
    mutationFn: ({ taskId, authorId, content, metadata }) =>
      entityType === "GROUP_TASK"
        ? groupTaskActivityService.addComment(taskId, authorId, content, metadata)
        : taskActivityService.addComment(taskId, authorId, content, metadata),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["taskActivity", taskId, entityType],
      });
      setMessage("");
      setMentions([]);
      clearAttachments();
      setReplyingTo(null);
    },
  });

  // Real-time subscription
  useEffect(() => {
    if (!taskId) return;

    const suffix = instanceId.current;
    const channel =
      entityType === "GROUP_TASK"
        ? groupTaskActivityService.subscribeToActivity(
          taskId,
          () => {
            queryClient.invalidateQueries({
              queryKey: ["taskActivity", taskId, entityType],
            });
          },
          suffix,
        )
        : taskActivityService.subscribeToActivity(
          taskId,
          () => {
            queryClient.invalidateQueries({
              queryKey: ["taskActivity", taskId, entityType],
            });
          },
          suffix,
        );

    return () => {
      if (entityType === "GROUP_TASK") {
        groupTaskActivityService.unsubscribeFromActivity(channel);
      } else {
        taskActivityService.unsubscribeFromActivity(channel);
      }
    };
  }, [taskId, entityType, queryClient]);

  // Auto-scroll on new entries
  useEffect(() => {
    if (scrollRef.current && activeTab === "ACTIVITY") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activity, activeTab]);



  const handleSend = useCallback(async () => {
    const hasText = message.trim();
    const hasFiles = attachments.length > 0;
    if ((!hasText && !hasFiles) || !taskId || !user?.id) return;
    if (isUploading || postCommentMutation.isPending) return;

    try {
      let attachmentUrls = [];
      if (hasFiles) {
        attachmentUrls = await uploadAttachments();
      }
      const metadata = {};
      if (attachmentUrls.length > 0) metadata.attachments = attachmentUrls;
      if (mentions.length > 0) metadata.mentions = mentions;
      if (replyingTo) metadata.replyTo = replyingTo;

      postCommentMutation.mutate({ taskId, authorId: user.id, content: message.trim(), metadata: Object.keys(metadata).length > 0 ? metadata : null });
    } catch (err) {
      console.error("Failed to upload chat attachments:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, attachments, taskId, user?.id, isUploading, replyingTo, uploadAttachments]);

  const toggleReaction = async (message, emoji) => {
    if (!message || !emoji) return;
    const currentReactions = message.metadata?.reactions || {};
    const usersWithEmoji = currentReactions[emoji] || [];
    const hasReacted = usersWithEmoji.includes(user?.id);

    let newReactions = { ...currentReactions };
    let isAdding = false;
    if (hasReacted) {
      newReactions[emoji] = usersWithEmoji.filter(id => id !== user?.id);
      if (newReactions[emoji].length === 0) delete newReactions[emoji];
    } else {
      newReactions[emoji] = [...usersWithEmoji, user?.id];
      isAdding = true;
    }

    const newMetadata = { ...(message.metadata || {}), reactions: newReactions };
    const table = entityType === "GROUP_TASK" ? "committee_task_activity" : "task_activity";

    // Optimistic update
    queryClient.setQueryData(
      ["taskActivity", taskId, entityType],
      (old = []) => old.map(m => m.id === message.id ? { ...m, metadata: newMetadata } : m)
    );

    try {
      const { error } = await supabase.rpc('toggle_chat_reaction', {
        p_table: table,
        p_message_id: message.id,
        p_user_id: user?.id,
        p_emoji: emoji
      });
      if (error) throw error;

      if (isAdding && message.authorId && message.authorId !== user?.id) {
        notificationService.createNotification({
          recipient_id: message.authorId,
          sender_id: user.id,
          type: "TASK_REACTION",
          title: "New Reaction",
          message: `${user?.user_metadata?.name || user?.name || "Someone"} reacted with ${emoji} to your message`,
          reference_id: taskId,
        });
      }
    } catch (err) {
      console.error("Failed to toggle reaction:", err);
      queryClient.invalidateQueries({
        queryKey: ["taskActivity", taskId, entityType],
      });
    }
  };

  // Only show legacy block when the task has NO real activity entries at all.
  // Modern tasks always get an APPROVED/HR_VERIFIED entry in history, so
  // history.length > 0 means this is not a legacy task.
  const showLegacy = comments.length === 0 && history.length === 0 && (legacyRemarks || legacyHrRemarks);

  return (
    <div className={
      isSplitScreen
        ? "w-[380px] shrink-0 flex flex-col bg-card border-l border-border h-full"
        : "flex flex-col border border-border rounded-xl overflow-hidden bg-card mt-4"
    }>
      <div className={
        isSplitScreen
          ? "flex items-center justify-between px-4 h-[61px] border-b border-border bg-muted/50 shrink-0"
          : "flex items-center justify-between px-4 py-2 border-b border-border bg-muted/50"
      }>
        <TabGroup
          variant="pill"
          tabs={[
            { value: "ACTIVITY", label: "Activity", icon: MessageCircle, badge: comments.length },
            { value: "HISTORY", label: "History", icon: Clock },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 custom-scrollbar px-4 py-4"
        style={!isSplitScreen ? { maxHeight: "500px", minHeight: "200px" } : {}}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size="md" />
          </div>
        ) : activeTab === "ACTIVITY" ? (
          <div className="space-y-4">
            {showLegacy && (
              <LegacyEntries
                remarks={legacyRemarks}
                hrRemarks={legacyHrRemarks}
                evaluatedByName={evaluatedByName}
                grade={grade}
              />
            )}

            {comments.length === 0 && !showLegacy && (
              <div className="text-center py-10">
                <MessageCircle size={24} className="mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground font-medium">No comments yet</p>
              </div>
            )}

            {commentsWithSeenBy.map((entry) => (
              <ActivityEntry
                key={entry.id}
                entry={entry}
                currentUserId={user?.id}
                avatarMap={avatarMap}
                onReply={(e) => setReplyingTo(buildReplySnapshot(e))}
                onReact={toggleReaction}
              />
            ))}
          </div>
        ) : (
          <HistoryTimeline logs={history} type="TASK" />
        )}
      </div>

      {activeTab === "ACTIVITY" && !disabled && (
        <form onSubmit={handleSend} className="bg-muted/30 border-t border-border p-3 min-w-0 w-full flex-none">
          <ReplyPreviewBar
            replyingTo={replyingTo}
            onCancel={() => setReplyingTo(null)}
            className="rounded-xl mb-2"
          />
          <FileInput
            ref={fileInputRef}
            accept={ALLOWED_MIME_TYPES.join(",")}
            multiple
            onFiles={addFiles}
          />

          {/* Attachment preview strip */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              <AttachmentPreviews files={attachments} onRemove={removeAttachment} />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.open()}
                className="w-14 h-14 rounded-lg border-dashed text-muted-foreground hover:text-foreground transition-colors"
              >
                <ImageIcon size={18} />
              </Button>
            </div>
          )}

          <div className="flex items-start gap-2">
            <MentionTextarea
              value={message}
              onChange={setMessage}
              onPaste={addFromPaste}
              onEnterSubmit={handleSend}
              people={employees}
              mentions={mentions}
              onMentionsChange={setMentions}
              placeholder="Send a message or paste an image..."
              containerClassName="flex-1"
              className={`w-full bg-card border border-border rounded-xl px-4 text-sm shadow-sm custom-scrollbar resize-none focus:outline-none focus:ring-1 ring-mauve-7 disabled:opacity-50 ${inputType === "textarea" ? "py-3 min-h-[50px] max-h-[150px]" : "h-11 py-2.5"}`}
              rows={1}
              disabled={postCommentMutation.isPending || isUploading}
            />
            <div className="flex flex-col gap-1 shrink-0">
              <Button
                onClick={handleSend}
                disabled={(!message.trim() && attachments.length === 0) || postCommentMutation.isPending || isUploading}
                className="w-11 h-11 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/20 active:scale-90 transition-all"
                size="icon"
              >
                {isUploading ? <Spinner size="sm" /> : <Send size={18} />}
              </Button>
              <div className="w-11 h-11 rounded-xl border border-border flex items-center justify-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => fileInputRef.current?.open()}
                  disabled={postCommentMutation.isPending || isUploading}
                  className="h-auto w-auto text-muted-foreground hover:text-foreground hover:bg-transparent transition-colors disabled:opacity-40"
                  title="Attach photo"
                >
                  <Paperclip size={15} />
                </Button>
                <EmojiPicker
                  align="end"
                  onSelect={(emoji) => setMessage((prev) => prev + emoji)}
                  disabled={postCommentMutation.isPending || isUploading}
                />
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
