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
  PlusCircle,
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
import ChecklistTaskInput from "../../../components/ChecklistTaskInput";
import GradeSelector from "../../../components/GradeSelector";
import { confirmDeleteToast } from "../../../components/ui/CustomToast";
import { activeChatService } from "../../../services/tasks/activeChatService";
import Select from "react-select";
import { LOG_TASK_SELECT_STYLES } from "../../../constants/task";
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

const GROUP_ROLES = ["EVENT", "CREATIVE", "DEMO", "BAC", "ODOO", "OTHERS"];

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

  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberId, setNewMemberId] = useState(null);
  const [newMemberRole, setNewMemberRole] = useState("");
  const [newMemberCustomRole, setNewMemberCustomRole] = useState("");
  const [newMemberDescType, setNewMemberDescType] = useState("description");
  const [newMemberDesc, setNewMemberDesc] = useState("");

  const [editingMemberId, setEditingMemberId] = useState(null);
  const [editMemberRole, setEditMemberRole] = useState("");
  const [editMemberCustomRole, setEditMemberCustomRole] = useState("");
  const [editMemberDescType, setEditMemberDescType] = useState("description");
  const [editMemberDesc, setEditMemberDesc] = useState("");

  const handleEditClick = (member) => {
    setEditingMemberId(member.id);
    setEditMemberRole(member.role || "");
    setEditMemberCustomRole(member.custom_role || "");

    const isChecklist =
      typeof member.task_description === "string" &&
      (member.task_description.trim().startsWith("[") ||
        member.task_description.trim().startsWith("{"));

    setEditMemberDescType(isChecklist ? "checklist" : "description");
    setEditMemberDesc(member.task_description || "");
  };

  const handleCancelEdit = () => {
    setEditingMemberId(null);
    setEditMemberRole("");
    setEditMemberCustomRole("");
    setEditMemberDescType("description");
    setEditMemberDesc("");
  };

  const handleUpdateMember = async () => {
    if (!editingMemberId || !editMemberDesc.trim()) return;
    await onUpdateMember(editingMemberId, {
      taskDescription: editMemberDesc,
      role: editMemberRole,
      customRole: editMemberCustomRole,
    });
    handleCancelEdit();
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
      setShowAddMember(false);
      setNewMemberId(null);
      setNewMemberRole("");
      setNewMemberCustomRole("");
      setNewMemberDescType("description");
      setNewMemberDesc("");
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

  if (!task) return null;

  const isCreator = task.created_by === currentUserId;
  const isCancelled = task.status === "CANCELLED";
  const isHrPending = task.status === "HR_PENDING";
  const isHrVerified = task.status === "HR_VERIFIED";
  const isCompletedOrBeyond =
    task.status === "COMPLETED" || isHrPending || isHrVerified;

  // Map display status: COMPLETED/HR_PENDING/HR_VERIFIED → "COMPLETED"
  const displayStatus = isCompletedOrBeyond ? "COMPLETED" : task.status;

  const members = task.members || [];
  const myMember = members.find((m) => m.employee_id === currentUserId);
  const allMembersDone =
    members.length > 0 && members.every((m) => m.status === "DONE");

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
              : "max-h-[90vh] sm:max-w-none w-[960px] max-w-[95vw] rounded-2xl",
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

              {/* Members List */}
              <div className="animate-content-in stagger-2 flex-1">
                <div className="flex items-center justify-between mb-4 pl-1">
                  <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    Group (Group) Members ({members.length})
                  </label>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {members.map((member) => {
                    const isMe = member.employee_id === currentUserId;
                    const canSeeGrade = isCreator || isSuperAdmin || isMe;
                    const showGrade =
                      isCompletedOrBeyond && canSeeGrade && member.grade > 0;

                    const isChecklist =
                      typeof member.task_description === "string" &&
                      (member.task_description.trim().startsWith("[") ||
                        member.task_description.trim().startsWith("{"));

                    let hasUncheckedItems = false;
                    if (isChecklist) {
                      try {
                        const parsed = JSON.parse(
                          member.task_description.trim(),
                        );
                        if (Array.isArray(parsed)) {
                          hasUncheckedItems = parsed.some((i) => !i.checked);
                        } else if (parsed && Array.isArray(parsed.items)) {
                          hasUncheckedItems = parsed.items.some(
                            (i) => !i.checked,
                          );
                        }
                      } catch (e) {}
                    }

                    return (
                      <div
                        key={member.id}
                        className={`p-5 border rounded-2xl flex flex-col gap-4 shadow-sm hover:shadow-md transition-all duration-300 transform origin-center ${isMe ? "border-primary/10 bg-primary/1" : "border-border bg-card"}`}
                      >
                        {editingMemberId === member.id ? (
                          // EDIT MODE
                          <div className="flex flex-col gap-4 animate-in fade-in">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-bold text-foreground uppercase tracking-widest">
                                Edit Assignment: {member.employee?.name}
                              </h4>
                            </div>

                            <div className="flex flex-col gap-2">
                              <label className="block text-[10px] font-bold text-muted-foreground uppercase">
                                Role (Optional)
                              </label>
                              <div className="flex flex-wrap gap-2">
                                {GROUP_ROLES.map((r) => (
                                  <button
                                    key={r}
                                    type="button"
                                    onClick={() =>
                                      setEditMemberRole(
                                        editMemberRole === r ? "" : r,
                                      )
                                    }
                                    className={`px-3 py-1.5 rounded-full text-[10px] font-bold tracking-wider transition-all ${
                                      editMemberRole === r
                                        ? "bg-primary text-primary-foreground shadow-sm"
                                        : "bg-card text-foreground border border-border hover:border-mauve-5"
                                    }`}
                                  >
                                    {r}
                                  </button>
                                ))}
                              </div>
                              {editMemberRole === "OTHERS" && (
                                <div className="animate-slide-down mt-1">
                                  <input
                                    type="text"
                                    value={editMemberCustomRole}
                                    onChange={(e) =>
                                      setEditMemberCustomRole(e.target.value)
                                    }
                                    placeholder="Specify custom role..."
                                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                                  />
                                </div>
                              )}
                            </div>

                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-end">
                                <label className="block text-[10px] font-bold text-muted-foreground uppercase">
                                  Specific Task
                                </label>
                                <div className="flex gap-0.5 bg-muted rounded border border-border p-0.5 w-fit">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditMemberDescType("description")
                                    }
                                    className={`text-[9px] px-2 py-0.5 rounded font-bold transition-all ${
                                      editMemberDescType === "description"
                                        ? "bg-card text-foreground shadow-sm"
                                        : "text-muted-foreground"
                                    }`}
                                  >
                                    Text
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditMemberDescType("checklist")
                                    }
                                    className={`text-[9px] px-2 py-0.5 rounded font-bold transition-all ${
                                      editMemberDescType === "checklist"
                                        ? "bg-card text-foreground shadow-sm"
                                        : "text-muted-foreground"
                                    }`}
                                  >
                                    Checklist
                                  </button>
                                </div>
                              </div>

                              {editMemberDescType === "checklist" ? (
                                <div className="bg-card rounded-lg border border-border p-1.5 flex-1 min-h-[96px]">
                                  <ChecklistTaskInput
                                    value={editMemberDesc}
                                    onChange={(e) =>
                                      setEditMemberDesc(e.target.value)
                                    }
                                  />
                                </div>
                              ) : (
                                <textarea
                                  value={editMemberDesc}
                                  onChange={(e) =>
                                    setEditMemberDesc(e.target.value)
                                  }
                                  placeholder="What exactly are they responsible for?"
                                  className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary/50 transition-colors h-24 resize-none flex-1"
                                />
                              )}
                            </div>

                            <div className="flex justify-end pt-2 gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={handleCancelEdit}
                                disabled={isUpdatingMember}
                                className="h-9 px-4 rounded-xl text-xs"
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                disabled={
                                  !editMemberDesc.trim() || isUpdatingMember
                                }
                                onClick={handleUpdateMember}
                                className="h-9 px-6 rounded-xl text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                              >
                                {isUpdatingMember
                                  ? "Saving..."
                                  : "Save Changes"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          // VIEW MODE
                          <>
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
                                  <span className="text-[9px] font-bold bg-mauve-4  text-mauve-11 dark:text-muted-foreground px-2 py-0.5 rounded shadow-sm uppercase tracking-wider border border-mauve-5 ">
                                    {member.custom_role || member.role}
                                  </span>
                                )}

                                <span
                                  className={`text-[9px] font-bold px-2 py-0.5 rounded shadow-sm uppercase tracking-wider ${
                                    member.status === "DONE"
                                      ? "bg-green-9/10 text-green-10 border border-green-500/20"
                                      : "bg-warning/10 text-amber-10 border border-amber-500/20"
                                  }`}
                                >
                                  {member.status}
                                </span>
                              </div>

                              {/* Head/Admin Controls (Temporarily Accessible to All) */}
                              {task.status === "ACTIVE" && (
                                  <div className="flex items-center gap-1">
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
                                      onClick={() =>
                                        handleRemoveMember(member.id)
                                      }
                                      disabled={isRemovingMember}
                                      className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-lg transition-colors disabled:opacity-50"
                                      title="Remove Member"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                )}
                            </div>

                            <div className="flex-1 flex flex-col gap-2 relative">
                              <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                Specific Task
                              </label>
                              {isChecklist ? (
                                <div className="bg-muted/30 rounded-xl p-3 border border-border/50 min-h-[80px]">
                                  <ChecklistTaskRenderer
                                    description={member.task_description}
                                    isOwner={isMe}
                                    disabled={!isMe || member.status === "DONE"}
                                    searchTerm={searchTerm}
                                    onInlineCheck={(newDesc) => {
                                      if (onInlineCheck) {
                                        onInlineCheck(member.id, newDesc);
                                      } else {
                                        groupTaskService
                                          .updateMemberTaskDescription(
                                            member.id,
                                            newDesc,
                                            task.id,
                                            currentUserId,
                                          )
                                          .catch(console.error);
                                      }
                                    }}
                                  />
                                </div>
                              ) : (
                                <div className="text-[13px] text-foreground bg-muted/20 p-4 rounded-xl border border-border/50 leading-relaxed min-h-[80px] whitespace-pre-wrap">
                                  {member.task_description}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-4 pt-1">
                              {/* Grades */}
                              {showGrade ? (
                                <div className="flex-1">
                                  <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">
                                    Grade
                                  </div>
                                  <div className="flex flex-col gap-1.5">
                                    <GradeSelector
                                      grade={member.grade}
                                      finalized
                                    />
                                    {member.grade_remarks && (
                                      <div className="text-xs text-muted-foreground bg-card border border-border/50 p-2 rounded-lg italic">
                                        "{member.grade_remarks}"
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div /> /* Spacer */
                              )}

                              {/* Action for the logged-in member */}
                              {isMe &&
                                member.status === "PENDING" &&
                                task.status === "ACTIVE" && (
                                  <button
                                    onClick={() => onMarkDone(member.id)}
                                    disabled={
                                      isMarkingDone ||
                                      (isChecklist && hasUncheckedItems)
                                    }
                                    title={
                                      isChecklist && hasUncheckedItems
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

                              {/* Undo action for Heads/Admins (Temporarily Accessible to All) */}
                              {member.status === "DONE" &&
                                task.status === "ACTIVE" && (
                                  <button
                                    onClick={() => onRevertDone(member.id)}
                                    disabled={isReverting}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-warning/10 text-amber-10 border border-amber-500/20 rounded-lg text-[10px] uppercase tracking-widest font-bold hover:bg-warning/20 transition-colors ml-auto"
                                  >
                                    {isReverting ? "..." : "Revert"}
                                  </button>
                                )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ADD MEMBER FORM (Temporarily Accessible to All) */}
              {task.status === "ACTIVE" && (
                <div className="mt-4 pt-4 border-t border-border/50">
                  {!showAddMember ? (
                    <button
                      type="button"
                      onClick={() => setShowAddMember(true)}
                      className="flex items-center justify-center gap-2 w-full h-[60px] border-2 border-dashed border-primary/20 rounded-xl text-primary font-bold text-xs hover:bg-primary/5 hover:border-primary/40 transition-colors"
                    >
                      <Plus size={16} /> Add Another Member
                    </button>
                  ) : (
                    <div className="p-5 border border-primary/20 rounded-xl bg-primary/5 flex flex-col gap-4 animate-in fade-in slide-in-from-top-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-foreground uppercase tracking-widest">
                          Add New Member
                        </h4>
                        <button
                          type="button"
                          onClick={() => setShowAddMember(false)}
                          className="p-1 text-muted-foreground hover:text-foreground hover:bg-card rounded-md"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <div className="flex flex-col gap-1.5 relative z-20">
                        <label className="block text-[10px] font-bold text-muted-foreground uppercase">
                          Assignee
                        </label>
                        <Select
                          className="w-full flex-1"
                          options={employeeOptions}
                          value={
                            employeeOptions.find(
                              (o) => o.value === newMemberId,
                            ) || null
                          }
                          onChange={(opt) => setNewMemberId(opt?.value)}
                          placeholder="Select Employee..."
                          classNamePrefix="react-select"
                          classNames={LOG_TASK_SELECT_STYLES}
                          unstyled
                          isClearable
                          menuShouldBlockScroll={false}
                          menuPortalTarget={document.body}
                          styles={{
                            menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                          }}
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="block text-[10px] font-bold text-muted-foreground uppercase">
                          Role (Optional)
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {GROUP_ROLES.map((r) => (
                            <button
                              key={r}
                              type="button"
                              onClick={() =>
                                setNewMemberRole(newMemberRole === r ? "" : r)
                              }
                              className={`px-3 py-1.5 rounded-full text-[10px] font-bold tracking-wider transition-all ${
                                newMemberRole === r
                                  ? "bg-primary text-primary-foreground shadow-sm"
                                  : "bg-card text-foreground border border-border hover:border-mauve-5"
                              }`}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                        {newMemberRole === "OTHERS" && (
                          <div className="animate-slide-down mt-1">
                            <input
                              type="text"
                              value={newMemberCustomRole}
                              onChange={(e) =>
                                setNewMemberCustomRole(e.target.value)
                              }
                              placeholder="Specify custom role..."
                              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-end">
                          <label className="block text-[10px] font-bold text-muted-foreground uppercase">
                            Specific Task
                          </label>
                          <div className="flex gap-0.5 bg-muted rounded border border-border p-0.5 w-fit">
                            <button
                              type="button"
                              onClick={() =>
                                setNewMemberDescType("description")
                              }
                              className={`text-[9px] px-2 py-0.5 rounded font-bold transition-all ${
                                newMemberDescType === "description"
                                  ? "bg-card text-foreground shadow-sm"
                                  : "text-muted-foreground"
                              }`}
                            >
                              Text
                            </button>
                            <button
                              type="button"
                              onClick={() => setNewMemberDescType("checklist")}
                              className={`text-[9px] px-2 py-0.5 rounded font-bold transition-all ${
                                newMemberDescType === "checklist"
                                  ? "bg-card text-foreground shadow-sm"
                                  : "text-muted-foreground"
                              }`}
                            >
                              Checklist
                            </button>
                          </div>
                        </div>

                        {newMemberDescType === "checklist" ? (
                          <div className="bg-card rounded-lg border border-border p-1.5 flex-1 min-h-[96px]">
                            <ChecklistTaskInput
                              value={newMemberDesc}
                              onChange={(e) => setNewMemberDesc(e.target.value)}
                            />
                          </div>
                        ) : (
                          <textarea
                            value={newMemberDesc}
                            onChange={(e) => setNewMemberDesc(e.target.value)}
                            placeholder="What exactly are they responsible for?"
                            className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary/50 transition-colors h-24 resize-none flex-1"
                          />
                        )}
                      </div>

                      <div className="flex justify-end pt-2">
                        <Button
                          type="button"
                          disabled={
                            !newMemberId ||
                            !newMemberDesc.trim() ||
                            isAddingMember
                          }
                          onClick={async () => {
                            if (!newMemberId || !newMemberDesc.trim()) return;
                            await onAddMember({
                              employeeId: newMemberId,
                              taskDescription: newMemberDesc,
                              role: newMemberRole,
                              customRole: newMemberCustomRole,
                            });
                            setShowAddMember(false);
                            setNewMemberId(null);
                            setNewMemberDesc("");
                            setNewMemberRole("");
                            setNewMemberCustomRole("");
                          }}
                          className="h-9 px-6 rounded-xl text-xs"
                        >
                          {isAddingMember ? "Adding..." : "Add Member"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
    </Dialog>
  );
}
