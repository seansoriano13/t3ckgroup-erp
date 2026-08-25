import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { taskActivityService } from "../services/tasks/taskActivityService";
import { groupTaskActivityService } from "../services/groupTaskActivityService";
import { storageService } from "../services/storageService";
import { useAuth } from "../context/AuthContext";
import { useEmployeeAvatarMap } from "../hooks/useEmployeeAvatarMap";
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
import { buildReplySnapshot } from "../utils/chatReply";

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
        <a
          key={`url-${i}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 opacity-90 hover:opacity-100 break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
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
function ActivityEntry({ entry, currentUserId, avatarMap, onReply }) {
  const isMe = entry.authorId === currentUserId;

  // --- COMMENT (Human message) ---
  return (
    <div className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
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
      <div className={`max-w-[85%] min-w-0 ${isMe ? "items-end" : "items-start"}`}>
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
        <SwipeToReplyWrapper isMe={isMe} onReply={() => onReply?.(entry)}>
          <div
            className={`px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm transition-all duration-300 whitespace-pre-wrap break-all ${isMe
                ? "bg-primary text-primary-foreground rounded-tr-none"
                : "bg-card text-foreground rounded-tl-none border border-border"
              }`}
          >
            <ReplyQuote replyTo={entry.metadata?.replyTo} />
            {entry.content && <p>{renderContent(entry.content, entry.metadata?.mentions, isMe)}</p>}
            {entry.metadata?.attachments?.length > 0 && (
              <div className={`flex flex-wrap gap-2 ${entry.content ? "mt-2" : ""}`}>
                {entry.metadata.attachments.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl overflow-hidden border border-white/10 hover:opacity-90 transition-opacity"
                  >
                    <img
                      src={url}
                      alt={`attachment-${i + 1}`}
                      className="max-w-[200px] max-h-[200px] object-cover rounded-xl"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>
        </SwipeToReplyWrapper>
        <p
          className={`text-[9px] font-bold text-muted-foreground mt-1 uppercase tracking-widest ${isMe ? "text-right" : "text-left"
            } px-1`}
        >
          {formatTime(entry.createdAt)}
        </p>
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
  const [replyingTo, setReplyingTo] = useState(null);
  const [attachments, setAttachments] = useState([]); // [{ file, preview }]
  const [isUploading, setIsUploading] = useState(false);
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

  const comments = activity.filter(e => e.type === "COMMENT");
  const history = activity.filter(e => e.type !== "COMMENT");

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
      setAttachments([]);
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

  const addFiles = useCallback((files) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    setAttachments((prev) => [
      ...prev,
      ...imageFiles.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
  }, []);

  const removeAttachment = useCallback((index) => {
    setAttachments((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].preview);
      next.splice(index, 1);
      return next;
    });
  }, []);

  const handlePaste = useCallback(
    (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItems = Array.from(items).filter((item) => item.type.startsWith("image/"));
      if (!imageItems.length) return;
      e.preventDefault();
      addFiles(imageItems.map((item) => item.getAsFile()).filter(Boolean));
    },
    [addFiles],
  );

  const handleSend = useCallback(async () => {
    const hasText = message.trim();
    const hasFiles = attachments.length > 0;
    if ((!hasText && !hasFiles) || !taskId || !user?.id) return;
    if (isUploading || postCommentMutation.isPending) return;

    setIsUploading(true);
    try {
      let attachmentUrls = [];
      if (hasFiles) {
        attachmentUrls = await Promise.all(
          attachments.map((a) => storageService.uploadToCloudinary(a.file)),
        );
      }
      const metadata = {};
      if (attachmentUrls.length > 0) metadata.attachments = attachmentUrls;
      if (mentions.length > 0) metadata.mentions = mentions;
      if (replyingTo) metadata.replyTo = replyingTo;

      postCommentMutation.mutate({ taskId, authorId: user.id, content: message.trim(), metadata: Object.keys(metadata).length > 0 ? metadata : null });
    } catch (err) {
      console.error("Failed to upload chat attachments:", err);
    } finally {
      setIsUploading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, attachments, taskId, user?.id, isUploading, replyingTo]);

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
        className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4"
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

            {comments.map((entry) => (
              <ActivityEntry
                key={entry.id}
                entry={entry}
                currentUserId={user?.id}
                avatarMap={avatarMap}
                onReply={(e) => setReplyingTo(buildReplySnapshot(e))}
              />
            ))}
          </div>
        ) : (
          <HistoryTimeline logs={history} type="TASK" />
        )}
      </div>

      {activeTab === "ACTIVITY" && !disabled && (
        <div className="px-4 py-4 border-t border-border bg-muted/30">
          <ReplyPreviewBar
            replyingTo={replyingTo}
            onCancel={() => setReplyingTo(null)}
            className="rounded-xl mb-2"
          />
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
          />

          {/* Image preview strip */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachments.map((att, i) => (
                <div
                  key={i}
                  className="relative group rounded-lg overflow-hidden border border-border"
                  style={{ width: 56, height: 56 }}
                >
                  <img src={att.preview} alt={`preview-${i}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={14} className="text-white" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-14 h-14 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <ImageIcon size={18} />
              </button>
            </div>
          )}

          <div className="flex items-start gap-2">
            <MentionTextarea
              value={message}
              onChange={setMessage}
              onPaste={handlePaste}
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
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={postCommentMutation.isPending || isUploading}
                  className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                  title="Attach photo"
                >
                  <Paperclip size={15} />
                </button>
                <EmojiPicker
                  align="end"
                  onSelect={(emoji) => setMessage((prev) => prev + emoji)}
                  disabled={postCommentMutation.isPending || isUploading}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
