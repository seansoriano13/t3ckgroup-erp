import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import toast from "react-hot-toast";
import {
  X,
  CheckCircle2,
  Star,
  Calendar,
  Users,
  FileText,
  Maximize2,
  Check,
  Trash2,
  Clock,
  Plus,
  User,
  Edit3,
  ShieldCheck,
  XCircle,
  AlertTriangle,
  Columns2,
  Send,
  Paperclip,
  ImageIcon,
  Zap,
} from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "../../../components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ChecklistTaskRenderer from "../../../components/ChecklistTaskRenderer";
import GradeSelector from "../../../components/GradeSelector";
import { confirmDeleteToast } from "../../../components/ui/CustomToast";
import { activeChatService } from "../../../services/tasks/activeChatService";
import { formatDueDate } from "@/utils/formatDate";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { groupTaskActivityService } from "@/services/groupTaskActivityService";
import { groupTaskService } from "@/services/groupTaskService";
import { storageService } from "@/services/storageService";
import { MessageCircle } from "lucide-react";
import HistoryTimeline from "@/components/HistoryTimeline";
import { useAuth } from "@/context/AuthContext";
import Avatar from "@/components/Avatar";
import { useEmployeeAvatarMap } from "@/hooks/useEmployeeAvatarMap";
import { cn } from "@/lib/utils";
import { groupRoleService } from "@/services/groupRoleService";
import GroupRoleManagerModal from "./GroupRoleManagerModal";
import GroupTaskMemberRail from "./GroupTaskMemberRail";
import GroupTaskMemberPanel from "./GroupTaskMemberPanel";
import {
  parseChecklist,
  hasChecklistContent,
  resolveAssignment,
} from "@/utils/checklist";
import EmojiPicker from "@/components/ui/EmojiPicker";
import ReplyPreviewBar from "@/components/ui/ReplyPreviewBar";
import ReplyQuote from "@/components/ui/ReplyQuote";
import SwipeToReplyWrapper from "@/components/ui/SwipeToReplyWrapper";
import { buildReplySnapshot } from "@/utils/chatReply";
import MentionTextarea from "@/components/ui/MentionTextarea";
import { supabase } from "@/lib/supabase";
import { useFileAttachments } from "@/hooks/useFileAttachments";
import { AttachmentPreviews, AttachmentList } from "@/components/ui/Attachments";
import { ALLOWED_MIME_TYPES } from "@/utils/attachments";

export default function GroupTaskDetailModal({
  isOpen,
  onClose,
  task,
  currentUserId,
  onMarkDone,
  onOpenRateModal,
  onDelete,
  onRevertDone,
  isMarkingDone,
  isReverting,
  isDeleting,
  isSuperAdmin,
  isHr,
  employees = [],
  onAddMember,
  isAddingMember,
  onUpdateMember,
  onRemoveMember,
  isUpdatingMember,
  isRemovingMember,
  onVerify,
  onReject,
  isVerifying,
  isRejecting,
  onInlineCheck,
  onUpdateTask,
  isUpdatingTask,
  onAddAttachment,
  isUploadingAttachment,
  searchTerm,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSplitScreen, setIsSplitScreen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectRemarks, setRejectRemarks] = useState("");

  // --- Inline chat state ---
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const chatScrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const [messageContent, setMessageContent] = useState("");
  const [mentions, setMentions] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const attachmentState = useFileAttachments();
  const {
    files: attachments,
    isUploading,
    addFiles,
    addFromPaste,
    removeFile: removeAttachment,
    clear: clearAttachments,
  } = attachmentState;
  const avatarMap = useEmployeeAvatarMap();
  


  const [isEditingTask, setIsEditingTask] = useState(false);
  const [taskEditDraft, setTaskEditDraft] = useState({ title: "", description: "", dueDate: "" });

  const [isRoleManagerOpen, setIsRoleManagerOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  // Holds the in-progress edit for the selected member, or a brand new member
  // when `id` is null. One shape covers both so the shared panel does not need
  // to know which case it is rendering.
  const [draft, setDraft] = useState(null);

  const { data: roles = [], isLoading: isRolesLoading } = useQuery({
    queryKey: ["groupRoles"],
    queryFn: groupRoleService.getRoles,
    enabled: isOpen,
  });

  const handleEditClick = (member) => {
    // Resolved rather than read raw, so editing a row that predates the 0016
    // backfill does not drop its serialised checklist into the description box
    // and then save it back as prose.
    const { description, checklist } = resolveAssignment(member);
    setDraft({
      id: member.id,
      employeeId: member.employee_id,
      taskDescription: description,
      checklist: checklist.length > 0 ? checklist : null,
      showChecklist: checklist.length > 0,
      role: member.role || "",
      customRole: member.custom_role || "",
    });
  };

  const handleStartAddMember = () => {
    setSelectedMemberId(null);
    setDraft({
      id: null,
      employeeId: null,
      taskDescription: "",
      checklist: null,
      showChecklist: false,
      role: "",
      customRole: "",
    });
  };

  const handleCancelEdit = () => setDraft(null);

  const handleDraftChange = (field, value) =>
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev));

  const normaliseDraftChecklist = (value) => {
    const items = parseChecklist(value).filter((i) => i?.text?.trim());
    return items.length > 0 ? items : null;
  };

  const handleSaveDraft = async () => {
    if (!draft) return;
    // An assignment is valid with description text OR checklist items — the
    // old code required description text, which would now reject a
    // checklist-only assignment.
    if (!draft.taskDescription.trim() && !hasChecklistContent(draft.checklist))
      return;

    const payload = {
      taskDescription: draft.taskDescription.trim(),
      checklist: normaliseDraftChecklist(draft.checklist),
      role: draft.role,
      customRole: draft.customRole,
    };

    if (draft.id) {
      await onUpdateMember(draft.id, payload);
    } else {
      if (!draft.employeeId) return;
      await onAddMember({ employeeId: draft.employeeId, ...payload });
    }
    setDraft(null);
  };

  const handleStartTaskEdit = () => {
    setTaskEditDraft({
      title: task.title || "",
      description: task.description || "",
      dueDate: task.due_date ? task.due_date.split("T")[0] : "",
    });
    setIsEditingTask(true);
  };

  const handleSaveTaskEdit = async () => {
    if (!taskEditDraft.title.trim()) {
      toast.error("Title is required");
      return;
    }
    await onUpdateTask(taskEditDraft);
    setIsEditingTask(false);
  };

  const handleRemoveMember = (memberId) => {
    confirmDeleteToast(
      "Remove Member",
      "Are you sure you want to remove this member from the task?",
      () => {
        onRemoveMember(memberId);
      },
    );
  };

  const { data: logs = [], isLoading: isLoadingLogs } = useQuery({
    queryKey: ["groupHistory", task?.id],
    queryFn: () => groupTaskService.getGroupTaskHistory(task.id),
    enabled: !!task?.id && isOpen && activeTab === "history",
  });

  const employeeOptions = useMemo(() => {
    return employees
      .filter((e) => !e.is_super_admin)
      .map((e) => ({ value: e.id, label: e.name, department: e.department }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [employees]);

  // Resets the modal when it opens. The idiomatic alternative is to remount on
  // a `key`, but that is the caller's decision to make and it changes what
  // happens when the same task is reopened — a half-typed message survives a
  // remount-on-id and does not survive this. Both call sites are also not
  // alike: GlobalDetailManager mounts the modal only while it is open and so
  // resets for free, while the group-tasks page keeps it mounted forever and
  // depends on this. So the reset stays here until someone decides which
  // reopen behaviour they want.
  /* eslint-disable react-hooks/set-state-in-effect -- see note above */
  useEffect(() => {
    if (isOpen) {
      setIsExpanded(false);
      setIsSplitScreen(false);
      setActiveTab("overview");
      setSelectedMemberId(null);
      setShowRejectForm(false);
      setRejectRemarks("");
      setMessageContent("");
      setMentions([]);
      clearAttachments();

      setIsEditingTask(false);
      setReplyingTo(null);
      handleCancelEdit();
    }
  }, [isOpen, clearAttachments]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // --- Inline chat: fetch messages ---
  const { data: rawMessages = [], isLoading: isLoadingChat } = useQuery({
    queryKey: ["chatMessages", "GROUP_TASK", task?.id],
    queryFn: () => groupTaskActivityService.getActivityForTask(task.id),
    enabled: !!task?.id && isOpen && isSplitScreen,
  });

  const { data: readReceipts = [] } = useQuery({
    queryKey: ["chatReadReceipts", "GROUP_TASK", task?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_read_receipts")
        .select("user_id, last_read_at")
        .eq("entity_type", "GROUP_TASK")
        .eq("entity_id", String(task.id));
      return data || [];
    },
    enabled: !!task?.id && isOpen && isSplitScreen,
  });

  const chatMessages = useMemo(() => {
    if (!rawMessages || rawMessages.length === 0) return [];
    
    // Calculate seenBy logic
    const userToLastSeenMsgId = {};
    for (const receipt of readReceipts) {
      if (receipt.user_id === user?.id) continue;
      
      const readAt = new Date(receipt.last_read_at).getTime();
      let latestMsg = null;
      for (const m of rawMessages) {
        if (new Date(m.createdAt).getTime() <= readAt) {
          if (!latestMsg || new Date(m.createdAt).getTime() > new Date(latestMsg.createdAt).getTime()) {
            latestMsg = m;
          }
        }
      }
      if (latestMsg) {
        if (latestMsg.authorId === receipt.user_id) {
          let latestNotTheirs = null;
          for (const m of rawMessages) {
            if (new Date(m.createdAt).getTime() <= readAt && m.authorId !== receipt.user_id) {
              if (!latestNotTheirs || new Date(m.createdAt).getTime() > new Date(latestNotTheirs.createdAt).getTime()) {
                latestNotTheirs = m;
              }
            }
          }
          if (latestNotTheirs) latestMsg = latestNotTheirs;
          else latestMsg = null;
        }

        if (latestMsg) {
          if (!userToLastSeenMsgId[latestMsg.id]) userToLastSeenMsgId[latestMsg.id] = [];
          const emp = employees.find(e => e.id === receipt.user_id);
          let name = emp?.name;
          if (!name) {
            const commentByThem = rawMessages.find(c => c.authorId === receipt.user_id);
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

    return rawMessages.map(m => ({
      ...m,
      seenBy: userToLastSeenMsgId[m.id] || []
    }));
  }, [rawMessages, readReceipts, user, employees, avatarMap]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages?.length]);

  // Real-time subscription for inline chat
  useEffect(() => {
    if (!isSplitScreen || !task?.id || !isOpen) return;
    const channel = groupTaskActivityService.subscribeToActivity(
      task.id,
      () => {
        queryClient.invalidateQueries({
          queryKey: ["chatMessages", "GROUP_TASK", task.id],
        });
      },
      "-split",
    );
    return () => {
      groupTaskActivityService.unsubscribeFromActivity(channel);
    };
  }, [isSplitScreen, task?.id, isOpen, queryClient]);

  // Real-time listener for read receipts
  useEffect(() => {
    if (!isSplitScreen || !task?.id || !isOpen) return;

    const channel = supabase
      .channel(`read-receipts-grouptask-${task.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_read_receipts",
          filter: `entity_id=eq.${task.id}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["chatReadReceipts", "GROUP_TASK", task.id],
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isSplitScreen, task?.id, isOpen, queryClient]);

  // --- Inline chat: send message mutation ---
  const sendMessageMutation = useMutation({
    mutationFn: ({ content, attachmentUrls = [], replyTo = null, messageMentions = [] }) => {
      const metadata = {};
      if (attachmentUrls.length > 0) metadata.attachments = attachmentUrls;
      if (replyTo) metadata.replyTo = replyTo;
      if (messageMentions.length > 0) metadata.mentions = messageMentions;
      return groupTaskActivityService.addComment(
        task.id,
        user.id,
        content,
        Object.keys(metadata).length > 0 ? metadata : null,
      );
    },
    onSuccess: () => {
      setMessageContent("");
      clearAttachments();
      setMentions([]);
      setReplyingTo(null);
      queryClient.invalidateQueries({
        queryKey: ["chatMessages", "GROUP_TASK", task?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["activeChats", user?.id] });
    },
  });

  const handleSendMessage = useCallback(
    async (e) => {
      e?.preventDefault();
      const hasText = messageContent.trim();
      const hasFiles = attachments.length > 0;
      if ((!hasText && !hasFiles) || !task?.id) return;
      if (isUploading || sendMessageMutation.isPending) return;
      try {
        let attachmentUrls = [];
        if (hasFiles) {
          attachmentUrls = await attachmentState.upload();
        }
        sendMessageMutation.mutate({ content: messageContent.trim(), attachmentUrls, replyTo: replyingTo, messageMentions: mentions });
      } catch (err) {
        toast.error("Failed to upload chat attachments");
        console.error("Failed to upload chat attachments:", err);
      }
    },
    [messageContent, attachments, task?.id, isUploading, sendMessageMutation, replyingTo, mentions, attachmentState],
  );

  // Helper: time ago
  const timeAgo = (dateString) => {
    if (!dateString) return "";
    const d = new Date(dateString);
    const diffMs = new Date() - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  // Helper: render URLs as links
  const renderContent = (text, messageMentions = [], isMe = false) => {
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
                className={cn(
                  "rounded px-1 font-semibold",
                  isMe ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/20 text-primary/90",
                )}
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
  };

  // Mark as read when opened (same pattern as TaskDetails)
  useEffect(() => {
    if (isOpen && task?.id && currentUserId) {
      activeChatService.markAsRead(currentUserId, "GROUP_TASK", task.id);
    }
  }, [isOpen, task?.id, currentUserId]);

  const resolveEmployeeName = (id) => {
    if (!id) return "Unknown";
    // 1. Try task members (most reliable for all users)
    const member = task.members?.find((m) => m.employee_id === id);
    if (member?.employee?.name) return member.employee.name;

    // 2. Try employees prop (only available for admins/heads)
    const emp = employees.find((e) => e.id === id);
    if (emp?.name) return emp.name;

    return "Unknown";
  };

  // These two must sit above the `!task` early return below — hooks cannot be
  // called conditionally, so they read through `task?.` instead.
  // Memoised so the `|| []` fallback does not hand orderedMembers a fresh
  // array identity on every render.
  const members = useMemo(() => task?.members || [], [task?.members]);

  // The row a member opens this modal for is almost always their own, so it
  // goes first and starts selected rather than being hunted for in a list.
  const orderedMembers = useMemo(() => {
    const mine = members.filter((m) => m.employee_id === currentUserId);
    const others = members.filter((m) => m.employee_id !== currentUserId);
    return [...mine, ...others];
  }, [members, currentUserId]);

  /**
   * Which member the panel is actually showing.
   *
   * Derived rather than corrected in an effect. Both rules below used to run as
   * a setState after render, which paints one frame against a member who is no
   * longer there — and on a list that changes while the modal is open (a member
   * removed, a task reloaded) that frame is the one the viewer sees.
   *
   *   · Nothing selected yet — open on the first member. `orderedMembers` puts
   *     the viewer first, so that is normally themselves, and a head or HR who
   *     is not on the task lands on the top of the list instead.
   *   · The selected member is gone — fall back to the first. Held off while a
   *     draft is open, so an in-progress edit is not yanked out from under the
   *     person making it.
   */
  const effectiveMemberId = useMemo(() => {
    if (!isOpen) return selectedMemberId;
    if (!selectedMemberId) return orderedMembers[0]?.id ?? null;
    if (!draft && !orderedMembers.some((m) => m.id === selectedMemberId)) {
      return orderedMembers[0]?.id ?? null;
    }
    return selectedMemberId;
  }, [isOpen, orderedMembers, selectedMemberId, draft]);

  if (!task) return null;

  const isCreator = task.created_by === currentUserId;
  const isHrPending = task.status === "HR_PENDING";
  const isHrVerified = task.status === "HR_VERIFIED";
  const isCompletedOrBeyond =
    task.status === "COMPLETED" || isHrPending || isHrVerified;

  // Map display status: COMPLETED/HR_PENDING/HR_VERIFIED → "COMPLETED"
  const displayStatus = isCompletedOrBeyond ? "COMPLETED" : task.status;

  const selectedMember =
    orderedMembers.find((m) => m.id === effectiveMemberId) || null;

  const handleDelete = () => {
    confirmDeleteToast(
      "Delete Group Task",
      "Are you sure you want to delete this group task? This action cannot be undone.",
      () => {
        onDelete();
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "p-0 gap-0 z-[70] shadow-[0_10px_40px_-10px_rgba(79,70,229,0.15)] flex flex-col transition-all duration-300 overflow-hidden outline-none",
          isExpanded
            ? "!w-screen !h-screen !max-w-none !max-h-none !rounded-none !top-0 !left-0 !right-0 !bottom-0 !translate-x-0 !translate-y-0 !border-0 m-0"
            : isSplitScreen
              ? "top-4 bottom-4 !translate-y-0 h-[calc(100vh-2rem)] max-h-none sm:max-w-none w-[95vw] xl:max-w-[1400px] rounded-2xl"
              : // Widened from 960px: the member area is a master/detail pair
                // now, and a 240px rail off 960px left the panel too narrow.
                "max-h-[90vh] sm:max-w-none w-[95vw] max-w-[1120px] rounded-2xl",
        )}
      >
        {/* CONTENT WRAPPER — split when isSplitScreen */}
        <div className={cn("flex flex-1 overflow-hidden", isSplitScreen ? "flex-row" : "flex-col")}>

        {/* TASK PANEL (left in split, full in normal) */}
        <div className="flex flex-col flex-1 overflow-hidden">

        {/* HEADER */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-mauve-3/40 shrink-0 relative overflow-hidden bg-card">
          <div className="space-y-1 mt-1 flex-1 max-w-3xl">
            <div className="flex items-center justify-between mb-2.5 w-full">
              <div className="flex items-center gap-2">
                <StatusBadge status={displayStatus} />
                {(isHrPending || isHrVerified) && (
                  <div
                    title={
                      isHrVerified ? "Verified by HR" : "Pending HR Verification"
                    }
                    className="flex items-center"
                  >
                    {isHrVerified ? (
                      <CheckCircle2 size={14} className="text-green-9" />
                    ) : (
                      <Clock size={14} className="text-amber-9" />
                    )}
                  </div>
                )}
              </div>
              {/* Edit button moved to footer */}
            </div>

            {isEditingTask ? (
              <div className="space-y-3 mt-2 animate-in fade-in slide-in-from-top-2 w-full pr-4">
                <div>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block">Title</label>
                  <Input 
                    value={taskEditDraft.title}
                    onChange={(e) => setTaskEditDraft(p => ({ ...p, title: e.target.value }))}
                    className="h-9 text-base font-bold bg-background/50 border-border/50 w-full"
                    placeholder="Task Title"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block">Description</label>
                  <textarea
                    value={taskEditDraft.description}
                    onChange={(e) => setTaskEditDraft(p => ({ ...p, description: e.target.value }))}
                    className="w-full bg-background/50 border border-border/50 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50 transition-colors h-20 resize-y"
                    placeholder="Task Description..."
                  />
                </div>
                <div className="w-48">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block">Due Date</label>
                  <Input 
                    type="date"
                    value={taskEditDraft.dueDate}
                    onChange={(e) => setTaskEditDraft(p => ({ ...p, dueDate: e.target.value }))}
                    className="h-9 bg-background/50 border-border/50 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditingTask(false)} className="h-8 px-3 text-xs">
                    Cancel
                  </Button>
                  <Button type="button" size="sm" onClick={handleSaveTaskEdit} disabled={isUpdatingTask} className="h-8 px-4 text-xs">
                    {isUpdatingTask ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-black text-foreground tracking-tight leading-tight">
                  {task.title}
                </h2>
                <div className="flex items-center gap-4 text-xs font-semibold text-muted-foreground mt-2">
                  <div className="flex items-center gap-1.5">
                    <Users size={14} className="text-primary/70" /> Created by{" "}
                    {task.creator?.name || "Unknown"}
                  </div>
                  {task.due_date && (
                    <div className="flex items-center gap-1.5">
                      <Calendar size={14} className="text-primary/70" /> Due{" "}
                      {formatDueDate(task.due_date)}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-1">
            {!isSplitScreen && (
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("OPEN_CHAT_MODAL", {
                      detail: { entityId: task.id, entityType: "GROUP_TASK", entityTitle: task.title },
                    }),
                  );
                }}
                title="Open Conversation in Chat Modal"
                className="p-1.5 rounded-md text-mauve-9 hover:bg-mauve-3 hover:text-mauve-11 transition-colors mr-1"
              >
                <MessageCircle size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsSplitScreen((prev) => !prev);
              }}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                isSplitScreen
                  ? "text-primary bg-primary/10 hover:bg-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/80",
              )}
              title={isSplitScreen ? "Exit Split Screen" : "Split Screen (Task + Chat)"}
            >
              <Columns2 size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsExpanded(!isExpanded);
              }}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              title={isExpanded ? "Collapse" : "Expand"}
            >
              <Maximize2 size={14} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* TABS (inside left panel) */}
        <div className="flex px-6 border-b border-border bg-card shrink-0 gap-6">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`py-3 text-sm font-bold border-b-2 transition-colors ${
              activeTab === "overview"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`py-3 text-sm font-bold border-b-2 transition-colors ${
              activeTab === "history"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            History
          </button>
        </div>

        {/* TASK CONTENT */}
        <div className="overflow-y-auto custom-scrollbar bg-card/50 p-6 space-y-8 flex-1">
          {activeTab === "overview" ? (
            <>
              {/* Description */}
              {!isEditingTask && task.description && (
                <div className="animate-content-in stagger-1 mb-2">
                  <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                    {task.description}
                  </p>
                </div>
              )}

              {/* MEMBERS — master / detail */}
              <div className="animate-content-in stagger-2 flex-1 flex flex-col md:flex-row min-h-[420px] border border-border rounded-2xl overflow-hidden bg-card">
                <div className="w-full md:w-[240px] shrink-0 h-[200px] md:h-auto md:min-h-0 border-b md:border-b-0 md:border-r border-border">
                  <GroupTaskMemberRail
                    members={orderedMembers}
                    selectedId={draft && !draft.id ? null : effectiveMemberId}
                    onSelect={(id) => {
                      setDraft(null);
                      setSelectedMemberId(id);
                    }}
                    onAdd={
                      (isCreator || isSuperAdmin) ? handleStartAddMember : undefined
                    }
                    currentUserId={currentUserId}
                    avatarMap={avatarMap}
                    resolveEmployee={(m) => ({
                      id: m.employee_id,
                      name: m.employee?.name,
                    })}
                    mode="detail"
                  />
                </div>

                <div className="flex-1 flex flex-col min-w-0 min-h-0">
                  {draft ? (
                    <>
                      <div className="px-6 pt-4 shrink-0">
                        <h4 className="text-xs font-bold text-foreground uppercase tracking-widest">
                          {draft.id ? "Edit Assignment" : "Add New Member"}
                        </h4>
                      </div>

                      <GroupTaskMemberPanel
                        member={draft}
                        employeeOptions={employeeOptions}
                        roles={roles}
                        isRolesLoading={isRolesLoading}
                        onManageRoles={() => setIsRoleManagerOpen(true)}
                        onChange={handleDraftChange}
                        canEditAssignment={!draft.id}
                      />

                      <div className="px-6 py-3 border-t border-border flex justify-end gap-2 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelEdit}
                          className="h-9 px-4 rounded-xl text-xs"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          disabled={
                            isAddingMember ||
                            isUpdatingMember ||
                            (!draft.id && !draft.employeeId) ||
                            (!draft.taskDescription.trim() &&
                              !hasChecklistContent(draft.checklist))
                          }
                          onClick={handleSaveDraft}
                          className="h-9 px-6 rounded-xl text-xs"
                        >
                          {draft.id
                            ? isUpdatingMember
                              ? "Saving…"
                              : "Save Changes"
                            : isAddingMember
                              ? "Adding…"
                              : "Add Member"}
                        </Button>
                      </div>
                    </>
                  ) : selectedMember ? (
                    (() => {
                      const member = selectedMember;
                      const isMe = member.employee_id === currentUserId;
                      const canSeeGrade = isCreator || isSuperAdmin || isMe;
                      const showGrade =
                        isCompletedOrBeyond && canSeeGrade && member.grade > 0;

                      // resolveAssignment so rows predating the 0016 backfill,
                      // whose checklist is still inside task_description, render
                      // as a checklist rather than as a wall of JSON.
                      const {
                        description: memberDescription,
                        checklist: checklistItems,
                      } = resolveAssignment(member);
                      const hasUncheckedItems = checklistItems.some(
                        (i) => !i.checked,
                      );
                      const isDone = member.status === "DONE";

                      return (
                        <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar px-6 py-5 flex flex-col gap-5">
                          {/* Identity + controls */}
                          <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-extrabold text-sm text-foreground tracking-tight">
                                {member.employee?.name}
                              </span>
                              {isMe && (
                                <span className="text-[9px] font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded shadow-sm uppercase tracking-wider">
                                  You
                                </span>
                              )}
                              {member.role && (
                                <span className="text-[9px] font-bold bg-mauve-4 text-mauve-11 dark:text-muted-foreground px-2 py-0.5 rounded shadow-sm uppercase tracking-wider border border-mauve-5">
                                  {member.custom_role || member.role}
                                </span>
                              )}
                              <span
                                className={`text-[9px] font-bold px-2 py-0.5 rounded shadow-sm uppercase tracking-wider ${
                                  isDone
                                    ? "bg-green-9/10 text-green-10 border border-green-500/20"
                                    : "bg-warning/10 text-amber-10 border border-amber-500/20"
                                }`}
                              >
                                {member.status}
                              </span>
                            </div>

                            {(isCreator || isSuperAdmin || (isMe && task.status === "ACTIVE" && member.status === "PENDING")) && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleEditClick(member)}
                                  className="p-1.5 text-muted-foreground hover:text-violet-10 hover:bg-violet-2 rounded-lg transition-colors"
                                  title="Edit Assignment"
                                >
                                  <Edit3 size={14} />
                                </button>
                                {(isCreator || isSuperAdmin) && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveMember(member.id)}
                                    disabled={isRemovingMember}
                                    className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-lg transition-colors disabled:opacity-50"
                                    title="Remove Member"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Description */}
                          <div className="flex flex-col gap-1.5">
                            <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                              Specific Task
                            </label>
                            {memberDescription?.trim() ? (
                              <div className="text-[13px] text-foreground bg-muted/20 p-4 rounded-xl border border-border/50 leading-relaxed whitespace-pre-wrap">
                                {memberDescription}
                              </div>
                            ) : (
                              <p className="text-[13px] text-muted-foreground italic">
                                No assignment details recorded.
                              </p>
                            )}
                          </div>

                          {/* Checklist — the assignee ticks their own items, and
                              only until they submit. DONE is what opens them to
                              grading, so the list has to freeze at the same
                              moment. */}
                          {checklistItems.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between">
                                <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                  Checklist
                                </label>
                                <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
                                  {checklistItems.filter((i) => i.checked).length}
                                  /{checklistItems.length}
                                </span>
                              </div>
                              <div className="bg-muted/30 rounded-xl p-3 border border-border/50">
                                <ChecklistTaskRenderer
                                  description={checklistItems}
                                  isOwner={isMe}
                                  disabled={!isMe || isDone}
                                  searchTerm={searchTerm}
                                  onInlineCheck={(next) => {
                                    if (onInlineCheck) {
                                      onInlineCheck(member.id, next);
                                    } else {
                                      groupTaskService
                                        .updateMemberChecklist(
                                          member.id,
                                          next,
                                          task.id,
                                          currentUserId,
                                        )
                                        .catch(err => {
                                          toast.error("Failed to update checklist");
                                          console.error("Checklist update error:", err);
                                        });
                                    }
                                  }}
                                />
                              </div>
                            </div>
                          )}

                          {/* The "no assignment details" fallback was merged into the description render block above */}

                          {/* Attachments Section */}
                          <div className="flex flex-col gap-1.5 mt-2">
                            <div className="flex items-center justify-between">
                              <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                Attachments
                              </label>
                              {isMe && member.status === "PENDING" && task.status === "ACTIVE" && (
                                <div className="relative">
                                  <input
                                    type="file"
                                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                    multiple
                                    accept="image/*"
                                    disabled={isUploadingAttachment}
                                    title="Upload attachments"
                                    onChange={async (e) => {
                                      const files = Array.from(e.target.files).filter((f) => f.type.startsWith("image/"));
                                      if (files.length > 0) {
                                        for (const file of files) {
                                          try {
                                            const url = await storageService.uploadToCloudinary(file);
                                            onAddAttachment(member.id, url);
                                          } catch (err) {
                                            console.error(err);
                                            toast.error(`Failed to upload ${file.name}`);
                                          }
                                        }
                                      }
                                      e.target.value = "";
                                    }}
                                  />
                                  <button
                                    type="button"
                                    disabled={isUploadingAttachment}
                                    className="text-[10px] text-primary hover:text-primary/80 font-semibold flex items-center gap-1 disabled:opacity-50"
                                  >
                                    <Paperclip size={10} />
                                    {isUploadingAttachment ? "Uploading..." : "Add File"}
                                  </button>
                                </div>
                              )}
                            </div>
                            
                            {member.attachments && member.attachments.length > 0 ? (
                              <div className="flex flex-wrap gap-2 p-3 bg-muted/20 rounded-xl border border-border/50">
                                {member.attachments.map((url, i) => (
                                  <a
                                    key={i}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-16 h-16 rounded-lg overflow-hidden border border-border/50 hover:opacity-80 transition-opacity bg-muted flex items-center justify-center"
                                  >
                                    <img src={url} alt={`Attachment ${i}`} className="w-full h-full object-cover" />
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[13px] text-muted-foreground italic">No attachments.</p>
                            )}
                          </div>

                          {/* Grade + actions */}
                          <div className="flex items-end justify-between gap-4 pt-1 mt-auto">
                            {showGrade ? (
                              <div className="flex-1">
                                <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">
                                  Grade
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  <GradeSelector grade={member.grade} finalized />
                                  {member.grade_remarks && (
                                    <div className="text-xs text-muted-foreground bg-card border border-border/50 p-2 rounded-lg italic">
                                      "{member.grade_remarks}"
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div />
                            )}

                            {isMe &&
                              member.status === "PENDING" &&
                              task.status === "ACTIVE" && (
                                <button
                                  onClick={() => onMarkDone(member.id)}
                                  disabled={isMarkingDone || hasUncheckedItems}
                                  title={
                                    hasUncheckedItems
                                      ? "Check all items first"
                                      : ""
                                  }
                                  className="flex items-center gap-1.5 px-4 py-2 bg-green-9 text-primary-foreground rounded-lg text-xs font-bold hover:bg-green-9 transition-colors shadow-sm disabled:opacity-50 ml-auto"
                                >
                                  <CheckCircle2 size={16} />
                                  {isMarkingDone
                                    ? "Marking..."
                                    : "Submit for Review"}
                                </button>
                              )}

                            {isDone && task.status === "ACTIVE" && (
                              <button
                                onClick={() => onRevertDone(member.id)}
                                disabled={isReverting}
                                className="flex items-center gap-1.5 px-4 py-2 bg-warning/10 text-amber-10 border border-amber-500/20 rounded-lg text-[10px] uppercase tracking-widest font-bold hover:bg-warning/20 transition-colors ml-auto"
                              >
                                {isReverting ? "..." : "Revert"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
                      No members on this group task yet.
                    </div>
                  )}
                </div>
              </div>

              {/* HR Remarks */}
              {task.hr_remarks && (
                <div className="bg-destructive/10 border border-red-500/20 p-5 rounded-2xl mt-6 shadow-sm animate-content-in stagger-3">
                  <h4 className="text-[10px] font-bold text-destructive uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <FileText size={12} /> HR Remarks
                  </h4>
                  <p className="text-sm text-red-900 dark:text-red-200/90 leading-relaxed font-medium">
                    {task.hr_remarks}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="p-0">
              <HistoryTimeline
                logs={(logs || []).map((log) => {
                  // Pre-filter ratings based on visibility rules
                  const rawRatings = log.details?.ratings;
                  const visibleRatings = Array.isArray(rawRatings)
                    ? rawRatings
                        .filter((r) => {
                          if (isCreator || isSuperAdmin) return true;
                          const member = task.members?.find(
                            (m) => m.id === r.memberId,
                          );
                          return member?.employee_id === currentUserId;
                        })
                        .map((r) => {
                          const member = task.members?.find(
                            (m) => m.id === r.memberId,
                          );
                          return {
                            ...r,
                            memberName: resolveEmployeeName(
                              member?.employee_id,
                            ),
                          };
                        })
                    : [];

                  const rawMembers = log.details?.members;
                  const formattedMembers = Array.isArray(rawMembers)
                    ? rawMembers.map((m) => ({
                        ...m,
                        name: resolveEmployeeName(m.employee_id),
                      }))
                    : [];

                  return {
                    ...log,
                    details: {
                      ...log.details,
                      ratings:
                        visibleRatings.length > 0 ? visibleRatings : null,
                      members:
                        formattedMembers.length > 0 ? formattedMembers : null,
                    },
                  };
                })}
                isLoading={isLoadingLogs}
                type="GROUP"
              />
            </div>
          )}
        </div>{/* End task content */}
        </div>{/* End task panel */}

        {/* INLINE CHAT PANEL */}
        {isSplitScreen && (
          <div className="w-[380px] shrink-0 flex flex-col bg-card border-l border-border">
            {/* Chat Header */}
            <div className="h-14 px-4 border-b border-border flex items-center gap-3 shrink-0 bg-card/80 backdrop-blur-sm">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <MessageCircle size={14} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-black truncate">Conversation</h3>
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Group Task Chat</p>
              </div>
            </div>

            {/* Messages Area */}
            <div
              ref={chatScrollRef}
              className="flex-1 overflow-y-auto custom-scrollbar py-3 space-y-1"
            >
              {isLoadingChat ? (
                <div className="flex items-center justify-center h-full gap-2 text-muted-foreground italic text-xs">
                  <Spinner size="sm" /> Fetching messages...
                </div>
              ) : chatMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full opacity-30 select-none gap-2">
                  <MessageCircle size={48} strokeWidth={1} />
                  <p className="text-sm font-black">Start a conversation</p>
                </div>
              ) : (
                chatMessages.map((m) => {
                  const isMe = m.authorId === user?.id;

                  if (m.type === "SYSTEM") {
                    return (
                      <div key={m.id} className="flex items-start gap-2 py-2 px-3 opacity-60">
                        <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          <Zap size={10} className="text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-muted-foreground italic leading-relaxed">{m.content}</p>
                          <p className="text-[9px] text-muted-foreground/60 mt-0.5">{timeAgo(m.createdAt)}</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={m.id}
                      className={cn("flex gap-2 px-3 py-1.5", isMe ? "flex-row-reverse" : "flex-row")}
                    >
                      <Avatar
                        name={m.authorName || "?"}
                        src={avatarMap.get(m.authorId) ?? undefined}
                        size="sm"
                        className={cn(
                          m.authorIsHead || m.authorIsSuperAdmin
                            ? "bg-amber-3 text-amber-10 border-amber-6"
                            : m.authorIsHr
                              ? "bg-blue-3 text-blue-10 border-blue-6"
                              : "",
                        )}
                      />
                      <div className={cn("max-w-[75%] min-w-0 flex flex-col", isMe ? "items-end" : "items-start")}>
                        <div className="flex items-center gap-1.5 mb-1 px-1">
                          <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight">
                            {isMe ? "You" : m.authorName}
                          </span>
                          {m.authorIsHead && (
                            <span className="text-[7px] bg-amber-3/50 text-amber-11 px-1 rounded font-black uppercase">Head</span>
                          )}
                          {m.authorIsHr && (
                            <span className="text-[7px] bg-blue-3/50 text-blue-11 px-1 rounded font-black uppercase">HR</span>
                          )}
                          {m.authorIsSuperAdmin && (
                            <span className="text-[7px] bg-primary/10 text-foreground px-1 rounded font-black uppercase">Admin</span>
                          )}
                        </div>
                        <SwipeToReplyWrapper isMe={isMe} onReply={() => setReplyingTo(buildReplySnapshot(m))}>
                          <div
                            className={cn(
                              "px-3 py-2 rounded-2xl text-xs shadow-sm whitespace-pre-wrap break-words min-w-0",
                              isMe
                                ? "bg-primary text-primary-foreground rounded-tr-none"
                                : "bg-muted border border-border rounded-tl-none",
                            )}
                            style={{ wordBreak: "break-word" }}
                          >
                            <ReplyQuote replyTo={m.metadata?.replyTo} />
                            {m.content && <p>{renderContent(m.content, m.metadata?.mentions, isMe)}</p>}
                            {m.metadata?.attachments?.length > 0 && (
                              <div className={cn(m.content ? "mt-2" : "")}>
                                <AttachmentList attachments={m.metadata.attachments} />
                              </div>
                            )}
                          </div>
                        </SwipeToReplyWrapper>
                        <div className={cn("flex items-center gap-1 mt-0.5", isMe ? "flex-row-reverse" : "flex-row")}>
                          <span className="text-[8px] text-muted-foreground/60 px-1 font-medium">
                            {timeAgo(m.createdAt)}
                          </span>
                          {/* Read Receipts Avatars */}
                          {m.seenBy?.length > 0 && (
                            <div className={cn("flex items-center gap-0.5", isMe ? "mr-1" : "ml-1")}>
                              {m.seenBy.map(u => (
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
                })
              )}
            </div>

            {/* Input Area */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-border bg-muted/10 shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_MIME_TYPES.join(",")}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              <div className="bg-card border border-border rounded-2xl p-1.5 focus-within:ring-2 ring-mauve-8/20 transition-shadow">
                <ReplyPreviewBar
                  replyingTo={replyingTo}
                  onCancel={() => setReplyingTo(null)}
                  className="rounded-t-xl -mx-1.5 -mt-1.5 mb-1.5"
                />
                {/* Pending attachment strip */}
                {attachments.length > 0 && (
                  <div className="mb-2 px-2 pt-2">
                    <AttachmentPreviews
                      files={attachments}
                      onRemove={removeAttachment}
                      disabled={isUploading || sendMessageMutation.isPending}
                    />
                  </div>
                )}

                <MentionTextarea
                  value={messageContent}
                  onChange={setMessageContent}
                  onPaste={addFromPaste}
                  onEnterSubmit={handleSendMessage}
                  people={employees}
                  mentions={mentions}
                  onMentionsChange={setMentions}
                  placeholder="Write a message or paste a file..."
                  className="w-full bg-transparent resize-none border-none shadow-none focus-visible:ring-0 text-sm block px-3 py-1.5 outline-none custom-scrollbar disabled:opacity-50 min-h-[36px]"
                  rows={1}
                  disabled={sendMessageMutation.isPending || isUploading}
                />

                <div className="flex items-center justify-between px-2 pt-0.5 pb-0.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sendMessageMutation.isPending || isUploading}
                      className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                      title="Attach photo"
                    >
                      <Paperclip size={14} />
                    </button>
                    <EmojiPicker
                      onSelect={(emoji) => setMessageContent((prev) => prev + emoji)}
                      disabled={sendMessageMutation.isPending || isUploading}
                    />
                  </div>
                  <Button
                    disabled={
                      (!messageContent.trim() && attachments.length === 0) ||
                      sendMessageMutation.isPending ||
                      isUploading
                    }
                    type="submit"
                    size="sm"
                    className="h-7 px-3 rounded-xl font-bold gap-1.5 text-xs"
                  >
                    {isUploading ? (
                      <><Spinner size="sm" /> Uploading</>
                    ) : sendMessageMutation.isPending ? (
                      "..."
                    ) : (
                      <>Send <Send size={12} /></>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        )}

        </div>

        {/* FOOTER */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-border bg-muted/30 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 rounded-b-2xl">
          <div className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground font-medium">
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted/80 border border-border rounded text-muted-foreground font-sans text-[9px]">
                Esc
              </kbd>
              <span>to close</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 sm:gap-3 w-full sm:w-auto ml-auto">
            {/* Delete Task Button */}
            {(isCreator || isSuperAdmin) && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-[13px] font-bold text-destructive/80 hover:text-destructive hover:bg-destructive/5 h-9 rounded-xl px-2 sm:px-4 mr-1 sm:mr-2"
                title="Delete Task"
              >
                <Trash2 size={14} className={isDeleting ? "animate-pulse" : "sm:mr-1.5"} />
                <span className="hidden sm:inline">{isDeleting ? "Deleting..." : "Delete Task"}</span>
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-[13px] font-bold text-muted-foreground/80 hover:text-foreground h-9 rounded-xl px-4"
            >
              Close
            </Button>

            {/* Edit Task Button */}
            {(isCreator || isSuperAdmin) && !isEditingTask && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleStartTaskEdit}
                className="text-[13px] font-bold h-9 rounded-xl px-3 sm:px-4 flex items-center gap-0 sm:gap-2 border-border/80 bg-card hover:bg-muted"
                title="Edit Task"
              >
                <Edit3 size={14} />
                <span className="hidden sm:inline">Edit Task</span>
              </Button>
            )}

            {/* Rate Button for Heads/Admins */}
            {(isCreator || isSuperAdmin) &&
              (task.status === "ACTIVE" || task.status === "COMPLETED") && (
                <Button
                  onClick={onOpenRateModal}
                  className="h-9 px-4 sm:px-6 rounded-xl shadow-lg shadow-primary/20 bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-0 sm:gap-2"
                  title={task.status === "ACTIVE" && task.hr_remarks ? "Resubmit" : "Rate"}
                >
                  <Star size={16} fill="currentColor" />
                  <span className="font-bold hidden sm:inline">
                    {task.status === "ACTIVE" && task.hr_remarks
                      ? "Resubmit"
                      : "Rate"}
                  </span>
                </Button>
              )}

            {/* HR Verification Actions */}
            {isHr && isHrPending && (
              <>
                {showRejectForm ? (
                  <div className="flex items-center gap-2 animate-in fade-in">
                    <input
                      type="text"
                      value={rejectRemarks}
                      onChange={(e) => setRejectRemarks(e.target.value)}
                      placeholder="Reason for rejection..."
                      className="h-9 px-3 bg-card border border-border rounded-xl text-xs text-foreground outline-none focus:border-red-400 transition-colors w-[220px]"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setShowRejectForm(false);
                        setRejectRemarks("");
                      }}
                      className="h-9 px-3 rounded-xl text-xs text-muted-foreground"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      disabled={!rejectRemarks.trim() || isRejecting}
                      onClick={() => {
                        onReject(rejectRemarks);
                        setShowRejectForm(false);
                        setRejectRemarks("");
                      }}
                      className="h-9 px-5 rounded-xl text-xs bg-destructive hover:bg-destructive text-primary-foreground font-bold"
                    >
                      {isRejecting ? "Rejecting..." : "Confirm Reject"}
                    </Button>
                  </div>
                ) : (
                  <>
                    <Button
                      type="button"
                      onClick={() => setShowRejectForm(true)}
                      className="h-9 px-5 rounded-xl text-xs bg-destructive/10 text-destructive border border-red-500/20 hover:bg-destructive/20 font-bold flex items-center gap-1.5"
                      variant="ghost"
                    >
                      <XCircle size={14} /> Reject
                    </Button>
                    <Button
                      type="button"
                      disabled={isVerifying}
                      onClick={() => onVerify()}
                      className="h-9 px-6 rounded-xl shadow-lg shadow-green-200 bg-green-9 hover:bg-green-9 text-primary-foreground flex items-center gap-2 font-bold text-xs"
                    >
                      <ShieldCheck size={16} />
                      {isVerifying ? "Verifying..." : "Verify & Approve"}
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
      <GroupRoleManagerModal
        isOpen={isRoleManagerOpen}
        onClose={() => setIsRoleManagerOpen(false)}
      />
    </Dialog>
  );
}
