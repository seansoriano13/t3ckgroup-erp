import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Spinner from "@/components/ui/Spinner";
import Dot from "./ui/Dot";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { activeChatService } from "../services/tasks/activeChatService";
import Avatar from "./Avatar";
import { useEmployeeAvatarMap } from "../hooks/useEmployeeAvatarMap";
import { taskActivityService } from "../services/tasks/taskActivityService";
import { groupTaskActivityService } from "../services/groupTaskActivityService";
import { taskService } from "../services/taskService";
import { groupTaskService } from "../services/groupTaskService";
import { storageService } from "../services/storageService";
import { useAuth } from "../context/AuthContext";
import {
  MessageCircle,
  X,
  Search,
  Send,
  ChevronLeft,
  ExternalLink,
  Target,
  ListCheck,
  Users,
  Zap,
  Star,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Paperclip,
  ImageIcon,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "../lib/supabase";
import { cn } from "@/lib/utils";
import TabGroup from "@/components/ui/TabGroup";
import HighlightText from "./HighlightText";

// -------------------------------------------------------------
//  HELPERS
// -------------------------------------------------------------

/**
 * Splits text into plain-text segments and URL segments,
 * rendering URLs as clickable <a> tags.
 */
function renderContent(text) {
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
}
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

// -------------------------------------------------------------
//  SUB-COMPONENTS
// -------------------------------------------------------------

function MessageBubble({ entry, currentUserId }) {
  const isMe = entry.authorId === currentUserId;
  const avatarMap = useEmployeeAvatarMap();

  if (entry.type === "SYSTEM") {
    return (
      <div className="flex items-start gap-3 py-2 px-4 opacity-70">
        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
          <Zap size={12} className="text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-muted-foreground italic leading-relaxed">
            {entry.content}
          </p>
          <p className="text-[9px] text-muted-foreground/60 mt-0.5">
            {timeAgo(entry.createdAt)}
          </p>
        </div>
      </div>
    );
  }

  if (entry.type === "APPROVAL" || entry.type === "HR_NOTE") {
    const isRejection =
      entry.metadata?.event === "REJECTED" ||
      (entry.type === "HR_NOTE" && entry.metadata?.event !== "HR_VERIFIED");
    const isVerified =
      entry.type === "HR_NOTE" && entry.metadata?.event === "HR_VERIFIED";

    return (
      <div
        className={cn(
          "mx-4 my-2 p-3 rounded-xl border border-dashed text-xs",
          isRejection
            ? "bg-red-3/50 border-red-6/20 text-red-11"
            : isVerified
              ? "bg-primary/5 border-border/20 text-foreground"
              : "bg-green-3/50 border-green-6/20 text-green-11",
        )}
      >
        <div className="flex items-center gap-2 mb-1">
          {isRejection ? (
            <AlertTriangle size={12} />
          ) : isVerified ? (
            <ShieldCheck size={12} />
          ) : (
            <Star size={12} />
          )}
          <span className="font-bold uppercase tracking-wider">
            {entry.type === "HR_NOTE" ? "HR Audit" : "Management Action"}
          </span>
          <span className="ml-auto opacity-60 text-[10px]">
            {timeAgo(entry.createdAt)}
          </span>
        </div>
        <p className="font-medium">
          {entry.content || (isVerified ? "Record Verified" : "Action taken")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-2",
        isMe ? "flex-row-reverse" : "flex-row",
      )}
    >
      <Avatar
        name={entry.authorName || "?"}
        src={avatarMap.get(entry.authorId) ?? undefined}
        size="md"
        className={cn(
          entry.authorIsHead || entry.authorIsSuperAdmin
            ? "bg-amber-3 text-amber-10 border-amber-6"
            : entry.authorIsHr
              ? "bg-blue-3 text-blue-10 border-blue-6"
              : "",
        )}
      />
      <div
        className={cn(
          "max-w-[80%] min-w-0 flex flex-col overflow-hidden",
          isMe ? "items-end" : "items-start",
        )}
      >
        <div className="flex items-center gap-2 mb-1 px-1">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">
            {isMe ? "You" : entry.authorName}
          </span>
          {entry.authorIsHead && (
            <span className="text-[8px] bg-amber-3/50 text-amber-11 px-1 rounded font-black uppercase">
              Head
            </span>
          )}
          {entry.authorIsHr && (
            <span className="text-[8px] bg-blue-3/50 text-blue-11 px-1 rounded font-black uppercase">
              HR
            </span>
          )}
          {entry.authorIsSuperAdmin && (
            <span className="text-[8px] bg-primary/10 text-foreground px-1 rounded font-black uppercase">
              Admin
            </span>
          )}
        </div>
        <div
          className={cn(
            "px-4 py-2.5 rounded-2xl text-sm shadow-sm transition-all whitespace-pre-wrap wrap-break-word overflow-hidden",
            isMe
              ? "bg-primary text-primary-foreground rounded-tr-none"
              : "bg-card border border-border rounded-tl-none",
          )}
        >
          {entry.content && <p>{renderContent(entry.content)}</p>}
          {entry.metadata?.attachments?.length > 0 && (
            <div
              className={cn(
                "flex flex-wrap gap-2",
                entry.content ? "mt-2" : "",
              )}
            >
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
                    className="max-w-[220px] max-h-[220px] object-cover rounded-xl"
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
        <span className="text-[9px] text-muted-foreground/60 mt-1 px-1 font-medium">
          {timeAgo(entry.createdAt)}
        </span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
//  MAIN COMPONENT
// -------------------------------------------------------------

export default function ComprehensiveChatModal({
  isOpen,
  onClose,
  initialEntityId,
  initialEntityType,
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const [selectedChat, setSelectedChat] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [messageContent, setMessageContent] = useState("");
  const [attachments, setAttachments] = useState([]); // [{ file, preview }]
  const [isUploading, setIsUploading] = useState(false);
  const [isMobileListVisible, setIsMobileListVisible] = useState(true);
  const [internalOpen, setInternalOpen] = useState(isOpen);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);

  // New states for archiving and selection
  const [viewFilter, setViewFilter] = useState("ACTIVE"); // "ACTIVE" | "ARCHIVED"
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState(new Set());

  useEffect(() => {
    const handleDetailsLoaded = () => setIsDetailsLoading(false);
    window.addEventListener("ENTITY_DETAILS_LOADED", handleDetailsLoaded);
    return () =>
      window.removeEventListener("ENTITY_DETAILS_LOADED", handleDetailsLoaded);
  }, []);

  useEffect(() => {
    setInternalOpen(isOpen);
  }, [isOpen]);

  // Hide FloatingMonthPicker while chat modal is open
  useEffect(() => {
    window.dispatchEvent(
      new Event(internalOpen ? "FLOATING_PICKER_HIDE" : "FLOATING_PICKER_SHOW"),
    );
  }, [internalOpen]);

  const { data: activeChats = [], isLoading: isLoadingList } = useQuery({
    queryKey: ["activeChats", user?.id],
    queryFn: () => activeChatService.getActiveChats(user?.id),
    enabled: !!user?.id && internalOpen,
  });

  // Global trigger for detail views
  useEffect(() => {
    const handleOpenChat = (e) => {
      const { entityId, entityType } = e.detail;
      if (entityId && entityType) {
        // Find existing chat or prepare to select it
        const chat = activeChats.find(
          (c) => c.entity_id === entityId && c.entity_type === entityType,
        );
        if (chat) {
          setSelectedChat(chat);
        } else {
          // If not in active chats (no messages yet), we create a synthetic placeholder
          setSelectedChat({
            entity_id: entityId,
            entity_type: entityType,
            title:
              entityType === "TASK"
                ? "New Task Thread"
                : "New Group Thread",
            is_placeholder: true,
          });
        }
        setIsMobileListVisible(false);
        setInternalOpen(true);
      }
    };
    window.addEventListener("OPEN_CHAT_MODAL", handleOpenChat);
    return () => window.removeEventListener("OPEN_CHAT_MODAL", handleOpenChat);
  }, [activeChats]);

  // -- Data: Messages for Selected Chat ----------------------
  const { data: messages = [], isLoading: isLoadingMessages } = useQuery({
    queryKey: [
      "chatMessages",
      selectedChat?.entity_type,
      selectedChat?.entity_id,
    ],
    queryFn: () =>
      selectedChat?.entity_type === "TASK"
        ? taskActivityService.getActivityForTask(selectedChat.entity_id)
        : groupTaskActivityService.getActivityForTask(
            selectedChat.entity_id,
          ),
    enabled: !!selectedChat && internalOpen,
  });

  // -- Data: Entity Details for Deletion Check ---------------
  const { data: selectedEntityData } = useQuery({
    queryKey: [
      "entityDetailsForChat",
      selectedChat?.entity_type,
      selectedChat?.entity_id,
    ],
    queryFn: async () => {
      if (selectedChat?.entity_type === "TASK") {
        return await taskService.getTaskById(selectedChat.entity_id);
      } else if (selectedChat?.entity_type === "GROUP_TASK") {
        return await groupTaskService.getGroupTaskById(
          selectedChat.entity_id,
        );
      }
      return null;
    },
    enabled: !!selectedChat && !selectedChat?.is_placeholder && internalOpen,
    staleTime: 0,
  });

  const isEntityDeleted =
    selectedEntityData?.status === "DELETED" ||
    selectedEntityData?.status === "CANCELLED" ||
    selectedEntityData?.is_deleted;
  const isEntityPendingWipe =
    selectedEntityData?.delete_requested_by && !isEntityDeleted;

  // -- Mutations ---------------------------------------------
  const markAsReadMutation = useMutation({
    mutationFn: ({ entityType, entityId, latestCreatedAt }) =>
      activeChatService.markAsRead(
        user?.id,
        entityType,
        entityId,
        latestCreatedAt,
      ),
    onSuccess: (_, variables) => {
      queryClient.setQueryData(["activeChats", user?.id], (old = []) =>
        old.map((c) =>
          c.entity_id === variables.entityId &&
          c.entity_type === variables.entityType
            ? { ...c, is_unread: false }
            : c,
        ),
      );
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (chats) => activeChatService.archiveChats(user?.id, chats),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activeChats", user?.id] });
      setSelectionMode(false);
      setSelectedChatIds(new Set());
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: (chats) => activeChatService.unarchiveChats(user?.id, chats),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activeChats", user?.id] });
      setSelectionMode(false);
      setSelectedChatIds(new Set());
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ entityType, entityId, content, attachmentUrls = [] }) => {
      const metadata =
        attachmentUrls.length > 0 ? { attachments: attachmentUrls } : null;
      return entityType === "TASK"
        ? taskActivityService.addComment(entityId, user.id, content, metadata)
        : groupTaskActivityService.addComment(
            entityId,
            user.id,
            content,
            metadata,
          );
    },
    onSuccess: () => {
      setMessageContent("");
      setAttachments([]);
      queryClient.invalidateQueries({
        queryKey: [
          "chatMessages",
          selectedChat?.entity_type,
          selectedChat?.entity_id,
        ],
      });
      queryClient.invalidateQueries({ queryKey: ["activeChats", user?.id] });
    },
  });

  // -- Effects -----------------------------------------------
  // Pre-select chat if initial entity provided
  useEffect(() => {
    if (
      isOpen &&
      initialEntityId &&
      initialEntityType &&
      activeChats.length > 0
    ) {
      const match = activeChats.find(
        (c) =>
          c.entity_id === initialEntityId &&
          c.entity_type === initialEntityType,
      );
      if (match) {
        setSelectedChat(match);
        setIsMobileListVisible(false);
      }
    }
  }, [isOpen, initialEntityId, initialEntityType, activeChats]);

  // Real-time listener for NEW comments globally (to update the list)
  useEffect(() => {
    if (!user?.id || !internalOpen) return;

    const channel = supabase
      .channel(`chat-system-updates-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "task_activity",
          filter: "type=eq.COMMENT",
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["activeChats", user.id] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "committee_task_activity",
          filter: "type=eq.COMMENT",
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["activeChats", user.id] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, internalOpen, queryClient]);

  // Real-time listener for current thread
  useEffect(() => {
    if (!selectedChat || !internalOpen) return;

    const channel =
      selectedChat.entity_type === "TASK"
        ? taskActivityService.subscribeToActivity(
            selectedChat.entity_id,
            () => {
              queryClient.invalidateQueries({
                queryKey: [
                  "chatMessages",
                  selectedChat.entity_type,
                  selectedChat.entity_id,
                ],
              });
            },
            "-modal",
          )
        : groupTaskActivityService.subscribeToActivity(
            selectedChat.entity_id,
            () => {
              queryClient.invalidateQueries({
                queryKey: [
                  "chatMessages",
                  selectedChat.entity_type,
                  selectedChat.entity_id,
                ],
              });
            },
            "-modal",
          );

    return () => {
      if (selectedChat.entity_type === "TASK")
        taskActivityService.unsubscribeFromActivity(channel);
      else groupTaskActivityService.unsubscribeFromActivity(channel);
    };
  }, [selectedChat, internalOpen, queryClient]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // -- Handlers ----------------------------------------------
  const handleClose = () => {
    setInternalOpen(false);
    onClose();
  };

  const handleChatSelect = (chat) => {
    if (selectionMode) {
      const key = `${chat.entity_type}_${chat.entity_id}`;
      setSelectedChatIds((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }

    setSelectedChat(chat);
    if (chat.is_unread) {
      markAsReadMutation.mutate({
        entityType: chat.entity_type,
        entityId: chat.entity_id,
        latestCreatedAt: chat.latest_created_at,
      });
    }
    setIsMobileListVisible(false);
  };

  const handleBulkArchiveToggle = () => {
    if (selectedChatIds.size === 0) return;
    const chatsToProcess = activeChats.filter((c) =>
      selectedChatIds.has(`${c.entity_type}_${c.entity_id}`),
    );

    if (viewFilter === "ACTIVE") {
      archiveMutation.mutate(chatsToProcess);
    } else {
      unarchiveMutation.mutate(chatsToProcess);
    }
  };

  const handleSend = useCallback(
    async (e) => {
      e?.preventDefault();
      const hasText = messageContent.trim();
      const hasFiles = attachments.length > 0;
      if ((!hasText && !hasFiles) || !selectedChat) return;
      if (isUploading || sendMessageMutation.isPending) return;

      setIsUploading(true);
      try {
        let attachmentUrls = [];
        if (hasFiles) {
          attachmentUrls = await Promise.all(
            attachments.map((a) => storageService.uploadToCloudinary(a.file)),
          );
        }
        sendMessageMutation.mutate({
          entityType: selectedChat.entity_type,
          entityId: selectedChat.entity_id,
          content: messageContent.trim(),
          attachmentUrls,
        });
      } catch (err) {
        console.error("Failed to upload chat attachments:", err);
      } finally {
        setIsUploading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messageContent, attachments, selectedChat, isUploading],
  );

  const addFiles = useCallback((files) => {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (!imageFiles.length) return;
    const newEntries = imageFiles.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
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
      const imageItems = Array.from(items).filter((item) =>
        item.type.startsWith("image/"),
      );
      if (!imageItems.length) return;
      e.preventDefault();
      const files = imageItems
        .map((item) => item.getAsFile())
        .filter(Boolean);
      addFiles(files);
    },
    [addFiles],
  );

  const filteredChats = useMemo(() => {
    let list = activeChats;
    // Apply View Filter
    if (viewFilter === "ACTIVE") {
      list = list.filter((c) => !c.is_archived);
    } else {
      list = list.filter((c) => c.is_archived);
    }

    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (c) =>
        c.title?.toLowerCase().includes(q) ||
        c.latest_message?.toLowerCase().includes(q) ||
        c.latest_author?.toLowerCase().includes(q),
    );
  }, [activeChats, searchQuery, viewFilter]);

  // -- Render ------------------------------------------------
  return (
    <Dialog
      open={internalOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="p-0 gap-0 z-100 bg-card border-border shadow-2xl w-[calc(100%-2rem)] sm:max-w-[90vw] md:max-w-5xl h-[90vh] md:h-[85vh] rounded-2xl overflow-hidden flex flex-row border-none ring-0 outline-none"
      >
        {/* SIDEBAR: Conversation List */}
        <div
          className={cn(
            "w-full md:w-[320px] bg-muted/30 border-r border-border flex flex-col transition-all",
            !isMobileListVisible && "hidden md:flex",
          )}
        >
          <div className="p-4 border-b border-border space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <MessageCircle size={20} className="text-foreground" />
                Conversations
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  variant={selectionMode ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setSelectionMode(!selectionMode);
                    setSelectedChatIds(new Set());
                  }}
                  className={cn(
                    "h-8 px-2 text-xs font-bold",
                    selectionMode &&
                      "bg-muted text-foreground hover:bg-violet-4",
                  )}
                >
                  {selectionMode ? "Cancel" : "Select"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleClose}
                  className="md:hidden"
                >
                  <X size={18} />
                </Button>
              </div>
            </div>

            {/* TABS */}
            <TabGroup
              type="pill"
              tabs={[
                { value: "ACTIVE", label: "Inbox" },
                { value: "ARCHIVED", label: "Archived" },
              ]}
              activeTab={viewFilter}
              onChange={(v) => {
                setViewFilter(v);
                setSelectionMode(false);
                setSelectedChatIds(new Set());
              }}
              fullWidth={true}
            />

            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                size={14}
              />
              <Input
                placeholder="Search conversations..."
                className="pl-9 bg-card border-border h-9 text-xs"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* SELECTION ACTIONS BAR */}
            {selectionMode && selectedChatIds.size > 0 && (
              <div className="flex items-center justify-between bg-mauve-2 border border-mauve-3 rounded-lg p-2 px-3">
                <span className="text-xs font-bold text-foreground">
                  {selectedChatIds.size} selected
                </span>
                <Button
                  size="sm"
                  onClick={handleBulkArchiveToggle}
                  disabled={
                    archiveMutation.isPending || unarchiveMutation.isPending
                  }
                  className="h-7 text-xs px-3 bg-primary hover:bg-primary-hover text-primary-foreground rounded-md font-bold"
                >
                  {viewFilter === "ACTIVE" ? "Archive" : "Unarchive"}
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
            {isLoadingList ? (
              <div className="p-8 text-center text-xs text-muted-foreground animate-pulse font-medium italic">
                Loading your chats...
              </div>
            ) : filteredChats.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <MessageCircle
                  size={32}
                  className="mx-auto text-muted-foreground/30"
                />
                <p className="text-xs font-bold text-muted-foreground">
                  No chats found
                </p>
              </div>
            ) : (
              filteredChats.map((chat) => {
                const chatKey = `${chat.entity_type}_${chat.entity_id}`;
                const isChecked = selectedChatIds.has(chatKey);

                return (
                  <button
                    key={chatKey}
                    onClick={() => handleChatSelect(chat)}
                    className={cn(
                      "w-full text-left p-3 rounded-xl transition-all flex items-start gap-3 group relative border",
                      selectionMode
                        ? "hover:bg-muted"
                        : selectedChat?.entity_id === chat.entity_id &&
                            selectedChat?.entity_type === chat.entity_type
                          ? "bg-mauve-3 border-mauve-3 ring-1 ring-mauve-6"
                          : "bg-transparent border-transparent hover:bg-card hover:border-border",
                    )}
                  >
                    {selectionMode && (
                      <div className="mt-1">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          readOnly
                          className="w-4 h-4 rounded-sm border-mauve-5 text-foreground focus:ring-mauve-8 pointer-events-none"
                        />
                      </div>
                    )}

                    <div
                      className={cn(
                        "p-2 rounded-lg shrink-0 flex items-center justify-center",
                        chat.is_unread
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {chat.entity_type === "TASK" ? (
                        <ListCheck size={16} />
                      ) : chat.entity_type === "GROUP_TASK" ? (
                        <Users size={16} />
                      ) : (
                        <Target size={16} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="flex justify-between items-center mb-0.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "text-[10px] font-black uppercase tracking-tighter opacity-70",
                              chat.entity_type === "TASK"
                                ? "text-foreground"
                                : chat.entity_type === "GROUP_TASK"
                                  ? "text-violet-9"
                                  : "text-green-10",
                            )}
                          >
                            {chat.entity_type === "GROUP_TASK"
                              ? "GROUP"
                              : chat.entity_type}
                          </span>
                          {chat.is_deleted &&
                            chat.entity_type !== "GROUP_TASK" && (
                              <span className="flex items-center gap-1 text-[9px] font-bold text-red-11 bg-red-3/50 px-1.5 py-0.5 rounded uppercase">
                                <Dot color="bg-destructive" className="block" />{" "}
                                Deleted
                              </span>
                            )}
                        </div>
                        <span className="text-[9px] text-muted-foreground/60 font-bold ml-2 shrink-0">
                          {timeAgo(chat.latest_created_at)}
                        </span>
                      </div>
                      <h4 className="text-[13px] font-bold truncate leading-tight mb-1">
                        <HighlightText
                          text={chat.title || ""}
                          search={searchQuery}
                        />
                      </h4>
                      <p className="text-xs text-muted-foreground truncate leading-relaxed">
                        <span className="font-bold text-foreground/80">
                          <HighlightText
                            text={chat.latest_author || ""}
                            search={searchQuery}
                          />
                          :
                        </span>{" "}
                        <HighlightText
                          text={chat.latest_message || ""}
                          search={searchQuery}
                        />
                      </p>
                    </div>
                    {chat.is_unread && !selectionMode && (
                      <Dot
                        size="w-2 h-2"
                        color="bg-primary"
                        className="absolute top-1/2 -right-1 -translate-y-1/2 shadow-lg shadow-foreground/40"
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* MAIN AREA: Chat Thread */}
        <div
          className={cn(
            "flex-1 flex flex-col bg-card relative",
            isMobileListVisible && "hidden md:flex",
          )}
        >
          {selectedChat ? (
            <>
              {/* Thread Header */}
              <div className="h-16 border-b border-border px-4 flex items-center justify-between shrink-0 bg-card/80 backdrop-blur-md z-10">
                <div className="flex items-center gap-3 overflow-hidden">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setIsMobileListVisible(true)}
                    className="md:hidden"
                  >
                    <ChevronLeft size={20} />
                  </Button>
                  <div className="min-w-0">
                    <h3 className="text-sm font-black truncate">
                      {selectedChat.title}
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                      {selectedChat.entity_type} •{" "}
                      {selectedChat.subtitle || "Overview"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-[11px] font-bold gap-1.5 border-border hover:bg-muted min-w-[80px]"
                    disabled={isDetailsLoading}
                    onClick={() => {
                      setIsDetailsLoading(true);
                      window.dispatchEvent(
                        new CustomEvent("OPEN_ENTITY_DETAILS", {
                          detail: {
                            id: selectedChat.entity_id,
                            type: selectedChat.entity_type,
                          },
                        }),
                      );
                      // Close the chat modal so the detail modal appears on top without z-index conflicts
                      setTimeout(() => {
                        setIsDetailsLoading(false);
                        setInternalOpen(false);
                        onClose();
                      }, 300);
                    }}
                  >
                    {isDetailsLoading ? (
                      <>
                        <Spinner size="sm" /> Loading
                      </>
                    ) : (
                      <>
                        Details <ExternalLink size={12} />
                      </>
                    )}
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={handleClose}>
                    <X size={20} />
                  </Button>
                </div>
              </div>

              {/* Banners for Deleted / Wipe Requested */}
              {isEntityDeleted ? (
                <div className="bg-red-3 border-b border-red-6 text-red-11 px-4 py-2 flex items-start sm:items-center gap-2 text-[11px] font-bold z-10 shrink-0">
                  <AlertTriangle
                    size={14}
                    className="mt-0.5 sm:mt-0 shrink-0"
                  />
                  <div className="leading-tight">
                    <span className="uppercase tracking-widest mr-1">
                      Deleted Record:
                    </span>
                    <span className="font-medium opacity-90">
                      This{" "}
                      {selectedChat?.entity_type?.toLowerCase() || "record"} has
                      been deleted. Chat history is preserved for auditing.
                    </span>
                  </div>
                </div>
              ) : isEntityPendingWipe ? (
                <div className="bg-amber-3 border-b border-amber-6 text-amber-11 px-4 py-2 flex items-start sm:items-center gap-2 text-[11px] font-bold z-10 shrink-0">
                  <AlertTriangle
                    size={14}
                    className="mt-0.5 sm:mt-0 shrink-0"
                  />
                  <div className="leading-tight">
                    <span className="uppercase tracking-widest mr-1">
                      Pending Wipe Request:
                    </span>
                    <span className="font-medium opacity-90">
                      A deletion request has been submitted for this{" "}
                      {selectedChat?.entity_type?.toLowerCase() || "record"}.
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Messages Area */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto custom-scrollbar py-4 space-y-1"
              >
                {isLoadingMessages ? (
                  <div className="flex items-center justify-center h-full gap-2 text-muted-foreground italic text-xs">
                    <Spinner size="sm" /> Fetching history...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full opacity-30 select-none">
                    <MessageCircle size={64} strokeWidth={1} />
                    <p className="text-sm font-black mt-2">
                      Start a conversation
                    </p>
                  </div>
                ) : (
                  messages.map((m) => (
                    <MessageBubble
                      key={m.id}
                      entry={m}
                      currentUserId={user.id}
                    />
                  ))
                )}
              </div>

              {/* Input Area */}
              <form
                onSubmit={handleSend}
                className="p-4 border-t border-border bg-muted/10"
              >
                {/* Hidden file input */}
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

                {isEntityDeleted ? (
                  <div className="bg-muted border border-border rounded-xl p-3 text-center text-xs font-bold text-muted-foreground opacity-70">
                    Input disabled. The associated record has been deleted.
                  </div>
                ) : (
                  <div className="bg-card border border-border rounded-2xl p-1.5 focus-within:ring-2 ring-mauve-8/20 transition-shadow">
                    {/* Image preview strip */}
                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 px-2 pt-2 pb-1">
                        {attachments.map((att, i) => (
                          <div
                            key={i}
                            className="relative group rounded-lg overflow-hidden border border-border"
                            style={{ width: 64, height: 64 }}
                          >
                            <img
                              src={att.preview}
                              alt={`preview-${i}`}
                              className="w-full h-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => removeAttachment(i)}
                              className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X size={16} className="text-white" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-16 h-16 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                        >
                          <ImageIcon size={20} />
                        </button>
                      </div>
                    )}

                    <Input
                      value={messageContent}
                      onChange={(e) => setMessageContent(e.target.value)}
                      onPaste={handlePaste}
                      placeholder="Write a message or paste an image..."
                      className="border-none shadow-none focus-visible:ring-0 text-sm h-10 disabled:opacity-50"
                      disabled={
                        sendMessageMutation.isPending ||
                        isUploading ||
                        isEntityDeleted
                      }
                    />
                    <div className="flex items-center justify-between px-2 pt-1 pb-0.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={
                            sendMessageMutation.isPending ||
                            isUploading ||
                            isEntityDeleted
                          }
                          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                          title="Attach photo"
                        >
                          <Paperclip size={15} />
                        </button>
                        <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                          <Clock size={10} /> Enter to send
                        </span>
                      </div>
                      <Button
                        disabled={
                          (!messageContent.trim() && attachments.length === 0) ||
                          sendMessageMutation.isPending ||
                          isUploading ||
                          isEntityDeleted
                        }
                        type="submit"
                        size="sm"
                        className="h-8 px-4 rounded-xl font-bold gap-2"
                      >
                        {isUploading ? (
                          <><Spinner size="sm" /> Uploading</>
                        ) : sendMessageMutation.isPending ? (
                          "..."
                        ) : (
                          <>Send <Send size={14} /></>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </form>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-4">
              <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center text-muted-foreground/30">
                <MessageCircle size={48} />
              </div>
              <div>
                <h3 className="text-lg font-bold">Your Conversations</h3>
                <p className="text-sm text-muted-foreground max-w-[280px]">
                  Select a task from the list to view its chat
                  history.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
