import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
import { parseChecklist, hasChecklistContent } from "../utils/checklist";

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
  const [attachments, setAttachments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const avatarMap = useEmployeeAvatarMap();

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
    setDraft({
      id: member.id,
      employeeId: member.employee_id,
      taskDescription: member.task_description || "",
      checklist: member.checklist ?? null,
      showChecklist: parseChecklist(member.checklist).length > 0,
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

  useEffect(() => {
    if (isOpen) {
      setIsExpanded(false);
      setIsSplitScreen(false);
      setActiveTab("overview");
      setSelectedMemberId(null);
      setShowRejectForm(false);
      setRejectRemarks("");
      setMessageContent("");
      setAttachments([]);
      handleCancelEdit();
    }
  }, [isOpen]);

  // --- Inline chat: fetch messages ---
  const { data: chatMessages = [], isLoading: isLoadingChat } = useQuery({
    queryKey: ["chatMessages", "GROUP_TASK", task?.id],
    queryFn: () => groupTaskActivityService.getActivityForTask(task.id),
    enabled: !!task?.id && isOpen && isSplitScreen,
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

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
  }, [isSplitScreen, task?.id, isOpen]);

  // --- Inline chat: send message mutation ---
  const sendMessageMutation = useMutation({
    mutationFn: ({ content, attachmentUrls = [] }) => {
      const metadata = attachmentUrls.length > 0 ? { attachments: attachmentUrls } : null;
      return groupTaskActivityService.addComment(task.id, user.id, content, metadata);
    },
    onSuccess: () => {
      setMessageContent("");
      setAttachments([]);
      queryClient.invalidateQueries({
        queryKey: ["chatMessages", "GROUP_TASK", task?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["activeChats", user?.id] });
    },
  });

  const addFiles = useCallback((files) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const newEntries = imageFiles.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    setAttachments((prev) => [...prev, ...newEntries]);
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
      const files = imageItems.map((item) => item.getAsFile()).filter(Boolean);
      addFiles(files);
    },
    [addFiles],
  );

  const handleSendMessage = useCallback(
    async (e) => {
      e?.preventDefault();
      const hasText = messageContent.trim();
      const hasFiles = attachments.length > 0;
      if ((!hasText && !hasFiles) || !task?.id) return;
      if (isUploading || sendMessageMutation.isPending) return;
      setIsUploading(true);
      try {
        let attachmentUrls = [];
        if (hasFiles) {
          attachmentUrls = await Promise.all(
            attachments.map((a) => storageService.uploadToCloudinary(a.file)),
          );
        }
        sendMessageMutation.mutate({ content: messageContent.trim(), attachmentUrls });
      } catch (err) {
        console.error("Failed to upload chat attachments:", err);
      } finally {
        setIsUploading(false);
      }
    },
    [messageContent, attachments, task?.id, isUploading],
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
  const renderContent = (text) => {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) =>
      urlRegex.test(part) ? (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 opacity-90 hover:opacity-100 break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
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

  useEffect(() => {
    if (!isOpen) return;
    // Select self on open, falling back to the first member for a viewer who
    // is not assigned to this task (a head or HR, say).
    if (!selectedMemberId && orderedMembers.length > 0) {
      setSelectedMemberId(orderedMembers[0].id);
      return;
    }
    // Keep the selection valid if the selected member is removed.
    if (
      selectedMemberId &&
      !draft &&
      !orderedMembers.some((m) => m.id === selectedMemberId)
    ) {
      setSelectedMemberId(orderedMembers[0]?.id ?? null);
    }
  }, [isOpen, orderedMembers, selectedMemberId, draft]);

  if (!task) return null;

  const isCreator = task.created_by === currentUserId;
  const isCancelled = task.status === "CANCELLED";
  const isHrPending = task.status === "HR_PENDING";
  const isHrVerified = task.status === "HR_VERIFIED";
  const isCompletedOrBeyond =
    task.status === "COMPLETED" || isHrPending || isHrVerified;

  // Map display status: COMPLETED/HR_PENDING/HR_VERIFIED → "COMPLETED"
  const displayStatus = isCompletedOrBeyond ? "COMPLETED" : task.status;

  const myMember = members.find((m) => m.employee_id === currentUserId);
  const allMembersDone =
    members.length > 0 && members.every((m) => m.status === "DONE");

  const selectedMember =
    orderedMembers.find((m) => m.id === selectedMemberId) || null;

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
              ? "top-4 bottom-4 !translate-y-0 h-[calc(100vh-2rem)] max-h-none sm:max-w-none w-[95vw] xl:w-[1400px] rounded-2xl"
              : // Widened from 960px: the member area is a master/detail pair
                // now, and a 240px rail off 960px left the panel too narrow.
                "max-h-[90vh] sm:max-w-none w-[1120px] max-w-[95vw] rounded-2xl",
        )}
      >
        {/* CONTENT WRAPPER — split when isSplitScreen */}
        <div className={cn("flex flex-1 overflow-hidden", isSplitScreen ? "flex-row" : "flex-col")}>

        {/* TASK PANEL (left in split, full in normal) */}
        <div className="flex flex-col flex-1 overflow-hidden">

        {/* HEADER */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-mauve-3/40 shrink-0 relative overflow-hidden bg-card">
          <div className="space-y-1 mt-1">
            <div className="flex items-center gap-2 mb-2.5">
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
          </div>

          <div className="flex items-center gap-1">
            {!isSplitScreen && (
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("OPEN_CHAT_MODAL", {
                      detail: { entityId: task.id, entityType: "GROUP_TASK" },
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
              {task.description && (
                <div className="animate-content-in stagger-1 mb-2">
                  <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                    {task.description}
                  </p>
                </div>
              )}

              {/* MEMBERS — master / detail */}
              <div className="animate-content-in stagger-2 flex-1 flex min-h-[420px] border border-border rounded-2xl overflow-hidden bg-card">
                <div className="w-[240px] shrink-0 min-h-0">
                  <GroupTaskMemberRail
                    members={orderedMembers}
                    selectedId={draft && !draft.id ? null : selectedMemberId}
                    onSelect={(id) => {
                      setDraft(null);
                      setSelectedMemberId(id);
                    }}
                    onAdd={
                      task.status === "ACTIVE" ? handleStartAddMember : undefined
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

                      const checklistItems = parseChecklist(member.checklist);
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

                            {task.status === "ACTIVE" && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleEditClick(member)}
                                  className="p-1.5 text-muted-foreground hover:text-violet-10 hover:bg-violet-2 rounded-lg transition-colors"
                                  title="Edit Assignment"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMember(member.id)}
                                  disabled={isRemovingMember}
                                  className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-lg transition-colors disabled:opacity-50"
                                  title="Remove Member"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Description */}
                          {member.task_description?.trim() && (
                            <div className="flex flex-col gap-1.5">
                              <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                Specific Task
                              </label>
                              <div className="text-[13px] text-foreground bg-muted/20 p-4 rounded-xl border border-border/50 leading-relaxed whitespace-pre-wrap">
                                {member.task_description}
                              </div>
                            </div>
                          )}

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
                                  description={member.checklist}
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
                                        .catch(console.error);
                                    }
                                  }}
                                />
                              </div>
                            </div>
                          )}

                          {!member.task_description?.trim() &&
                            checklistItems.length === 0 && (
                              <p className="text-[13px] text-muted-foreground italic">
                                No assignment details recorded.
                              </p>
                            )}

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
                        <div
                          className={cn(
                            "px-3 py-2 rounded-2xl text-xs shadow-sm whitespace-pre-wrap break-words overflow-hidden",
                            isMe
                              ? "bg-primary text-primary-foreground rounded-tr-none"
                              : "bg-muted border border-border rounded-tl-none",
                          )}
                        >
                          {m.content && <p>{renderContent(m.content)}</p>}
                          {m.metadata?.attachments?.length > 0 && (
                            <div className={cn("flex flex-wrap gap-1.5", m.content ? "mt-2" : "")}>
                              {m.metadata.attachments.map((url, i) => (
                                <a
                                  key={i}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block rounded-lg overflow-hidden border border-white/10 hover:opacity-90 transition-opacity"
                                >
                                  <img
                                    src={url}
                                    alt={`attachment-${i + 1}`}
                                    className="max-w-[160px] max-h-[160px] object-cover rounded-lg"
                                    loading="lazy"
                                  />
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="text-[8px] text-muted-foreground/60 mt-0.5 px-1 font-medium">
                          {timeAgo(m.createdAt)}
                        </span>
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
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              <div className="bg-card border border-border rounded-2xl p-1.5 focus-within:ring-2 ring-mauve-8/20 transition-shadow">
                {/* Image preview strip */}
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-2 pt-2 pb-1">
                    {attachments.map((att, i) => (
                      <div
                        key={i}
                        className="relative group rounded-lg overflow-hidden border border-border"
                        style={{ width: 52, height: 52 }}
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
                      className="w-[52px] h-[52px] rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                    >
                      <ImageIcon size={16} />
                    </button>
                  </div>
                )}

                <Input
                  value={messageContent}
                  onChange={(e) => setMessageContent(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Write a message..."
                  className="border-none shadow-none focus-visible:ring-0 text-sm h-9"
                  disabled={sendMessageMutation.isPending || isUploading}
                />

                <div className="flex items-center justify-between px-2 pt-0.5 pb-0.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sendMessageMutation.isPending || isUploading}
                    className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                    title="Attach photo"
                  >
                    <Paperclip size={14} />
                  </button>
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
        <div className="px-6 py-4 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
          <div className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground font-medium">
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted/80 border border-border rounded text-muted-foreground font-sans text-[9px]">
                Esc
              </kbd>
              <span>to close</span>
            </div>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            {/* Delete Task Button */}
            {(isCreator || isSuperAdmin) && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-[13px] font-bold text-destructive/80 hover:text-destructive hover:bg-destructive/5 h-9 rounded-xl px-4 mr-2"
              >
                {isDeleting ? (
                  "Deleting..."
                ) : (
                  <Trash2 size={14} className="mr-1.5" />
                )}
                {!isDeleting && "Delete Task"}
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

            {/* Rate Button for Heads/Admins */}
            {(isCreator || isSuperAdmin) &&
              (task.status === "ACTIVE" || task.status === "COMPLETED") && (
                <Button
                  onClick={onOpenRateModal}
                  className="h-9 px-6 rounded-xl shadow-lg shadow-primary/20 bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-2"
                >
                  <Star size={16} fill="currentColor" />
                  <span className="font-bold">
                    {task.status === "ACTIVE" && task.hr_remarks
                      ? "Resubmit"
                      : "Rate & Complete"}
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
