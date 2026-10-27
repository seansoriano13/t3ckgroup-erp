import React, { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notificationService } from "../services/notificationService";
import { useAuth } from "../context/AuthContext";
import {
  Bell,
  X,
  CheckCheck,
  ShieldAlert,
  CheckCircle2,
  Clock,
  XCircle,
  FileText,
  Briefcase,
  TrendingUp,
  Trophy,
  Trash2,
  MessageCircle,
  Target,
  MoreHorizontal,
  MailWarning,
  MailOpen,
} from "lucide-react";
import { useNavigate } from "react-router";
import { supabase } from "../lib/supabase";
import Dropdown from "./ui/Dropdown";
import { confirmDeleteToast } from "./ui/CustomToast";
import toast from "react-hot-toast";
import TabGroup from "./ui/TabGroup";
import Avatar from "./Avatar";
import { useEmployeeAvatarMap } from "../hooks/useEmployeeAvatarMap";
import Dot from "./ui/Dot";
import { Button } from "./ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "./ui/drawer";
import { handleNotificationRoute } from "../utils/notificationRouter";
import { showNotificationPopup } from "../utils/notificationPopup";

// ─── Relative Timestamp ───────────────────────────────────────────────────────
function getRelativeTime(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function getFullDate(dateStr) {
  return new Date(dateStr).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Safely renders notification message — handles cases where message is stored as JSON string
function safeRenderMessage(msg) {
  if (!msg) return "";
  if (typeof msg !== "string") return String(msg);
  const trimmed = msg.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        return parsed.text || parsed.message || parsed.body || parsed.content || msg;
      }
    } catch {
      // Not valid JSON — return as-is
    }
  }
  return msg;
}

// ─── Icon Map ─────────────────────────────────────────────────────────────────
const TYPE_ICONS = {
  TASK_GRADED: <CheckCircle2 size={18} className="text-green-500" />,
  TASK_REJECTED: <XCircle size={18} className="text-red-500" />,
  TASK_VERIFIED: <ShieldAlert size={18} className="text-primary" />,
  TASK_COMPLETED: <Trophy size={18} className="text-green-9" />,
  NEW_TASK_SUBMITTED: <Clock size={18} className="text-amber-500" />,
  TASK_ASSIGNED: <Briefcase size={18} className="text-blue-600" />,
  TASK_APPROVED_BY_HEAD: <CheckCircle2 size={18} className="text-amber-600" />,
  GROUP_ASSIGNED: <Briefcase size={18} className="text-violet-9" />,
  GROUP_TASK_REOPENED: <Briefcase size={18} className="text-violet-9" />,
  GROUP_TASK_COMMENT: <MessageCircle size={18} className="text-violet-9" />,
  GROUP_TASK_READY_FOR_HR: (
    <CheckCircle2 size={18} className="text-violet-10" />
  ),
  GROUP_MEMBER_DONE: <CheckCircle2 size={18} className="text-green-500" />,
  GROUP_TASK_AWAITING_EVALUATION: <CheckCircle2 size={18} className="text-amber-600" />,
  GROUP_TASK_EVALUATION_REMINDER: <Clock size={18} className="text-amber-500" />,
  OPPORTUNITY_REGISTERED: <Target size={18} className="text-primary" />,
  OPPORTUNITY_STAGE_CHANGED: <TrendingUp size={18} className="text-blue-600" />,
  // TODO: transition shim — drop with LEGACY_TYPE_ALIASES in notificationRouter.js.
  // Pre-rename rows still carry COMMITTEE_*; without these they fall back to the
  // generic bell icon.
  COMMITTEE_ASSIGNED: <Briefcase size={18} className="text-violet-9" />,
  COMMITTEE_TASK_COMMENT: <MessageCircle size={18} className="text-violet-9" />,
  COMMITTEE_TASK_READY_FOR_HR: (
    <CheckCircle2 size={18} className="text-violet-10" />
  ),
  COMMITTEE_MEMBER_DONE: <CheckCircle2 size={18} className="text-green-500" />,
};

const getIconForType = (type) =>
  TYPE_ICONS[type] ?? <Bell size={18} className="text-gray-9" />;

// ─── Tabs config ──────────────────────────────────────────────────────────────
const buildTabs = (user) => [
  { value: "ALL", label: "ALL" },
  { value: "UNREAD", label: "UNREAD" },
  ...(user?.has_task_flow || user?.isHr || user?.isSuperAdmin
    ? [{ value: "TASKS", label: "TASKS" }]
    : []),
  ...(user?.has_sales_flow || user?.isHr || user?.isSuperAdmin
    ? [{ value: "OPPORTUNITIES", label: "OPPORTUNITIES" }]
    : []),
];

// ─── Filter helper ────────────────────────────────────────────────────────────
const filterNotifs = (notifications, tab) => {
  if (tab === "TASKS")
    return notifications.filter(
      (n) => n.type.includes("TASK") || n.type.includes("GROUP"),
    );
  if (tab === "OPPORTUNITIES")
    return notifications.filter((n) => n.type.startsWith("OPPORTUNITY_"));
  if (tab === "UNREAD") return notifications.filter((n) => !n.is_read);
  return notifications; // ALL
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function NotificationDrawer({ isOpen, onClose }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const avatarMap = useEmployeeAvatarMap();

  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const [activeTab, setActiveTab] = useState("ALL");

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: () => notificationService.getMyNotifications(user?.id),
    enabled: !!user?.id && isOpen,
  });

  // Real-time subscription
  useEffect(() => {
    if (!user?.id) return;
    const subscription = notificationService.subscribeToNotifications(
      user.id,
      (newNotif) => {
        queryClient.setQueryData(["notifications", user.id], (old = []) => [
          newNotif,
          ...old,
        ]);
        
        const avatarUrl = avatarMap.get(newNotif.sender_id || newNotif.sender?.id);
        showNotificationPopup(newNotif, navigate, userRef.current, avatarUrl);
      },
    );
    return () => {
      if (subscription) supabase.removeChannel(subscription);
    };
  }, [user?.id, queryClient, navigate, avatarMap]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const markReadMutation = useMutation({
    mutationFn: (id) => notificationService.markAsRead(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData(["notifications", user?.id], (old = []) =>
        old.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
    },
  });

  const markUnreadMutation = useMutation({
    mutationFn: (id) => notificationService.markAsUnread(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData(["notifications", user?.id], (old = []) =>
        old.map((n) => (n.id === id ? { ...n, is_read: false } : n)),
      );
      toast.success("Marked as unread");
    },
    onError: (err) => toast.error(err.message),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationService.markAllAsRead(user?.id),
    onSuccess: () => {
      queryClient.setQueryData(["notifications", user?.id], (old = []) =>
        old.map((n) => ({ ...n, is_read: true })),
      );
    },
  });

  const markAllUnreadMutation = useMutation({
    mutationFn: () => notificationService.markAllAsUnread(user?.id),
    onSuccess: () => {
      queryClient.setQueryData(["notifications", user?.id], (old = []) =>
        old.map((n) => ({ ...n, is_read: false })),
      );
      toast.success("All notifications reset to unread");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteNotifMutation = useMutation({
    mutationFn: (id) => notificationService.deleteNotification(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData(["notifications", user?.id], (old = []) =>
        old.filter((n) => n.id !== id),
      );
      toast.success("Notification removed");
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Derived state ─────────────────────────────────────────────────────────
  const filteredNotifs = useMemo(
    () => filterNotifs(notifications, activeTab),
    [notifications, activeTab],
  );

  // ── Handler ───────────────────────────────────────────────────────────────
  const handleNotificationClick = (notif) => {
    if (!notif.is_read) markReadMutation.mutate(notif.id);
    handleNotificationRoute(notif, user, navigate, onClose);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        {/* Header */}
        <div className="p-6 border-b border-border flex justify-between items-center bg-card shrink-0">
          <div>
            <DrawerTitle className="text-xl font-bold text-foreground flex items-center gap-2 leading-normal">
              <Bell size={20} className="text-foreground" /> Notifications
            </DrawerTitle>
            <p className="text-label text-muted-foreground mt-0.5 uppercase tracking-wider font-semibold">
              Your Universal Action Hub
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => markAllReadMutation.mutate()}
              className="h-auto text-label font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors px-2 py-1 rounded-md uppercase tracking-tight"
            >
              Mark All Read
            </Button>
            <Button
              variant="outline"
              onClick={() => markAllUnreadMutation.mutate()}
              className="h-auto text-label font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors px-2 py-1 rounded-md uppercase tracking-tight"
            >
              Mark All Unread
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="h-auto w-auto p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-colors"
            >
              <X size={20} />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="p-2 shrink-0">
          <TabGroup
            variant="underline"
            tabs={buildTabs(user)}
            activeTab={activeTab}
            onChange={setActiveTab}
            fullWidth={true}
          />
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="p-10 text-center text-muted-foreground italic text-sm font-medium animate-pulse">
              Syncing timeline...
            </div>
          ) : filteredNotifs.length === 0 ? (
            <div className="p-10 text-center flex flex-col items-center">
              <Bell size={32} className="text-slate-300/50 mb-3" />
              <p className="text-foreground font-bold">You're all caught up!</p>
              <p className="text-muted-foreground text-xs mt-1">
                No alerts for this filter.
              </p>
            </div>
          ) : (
            filteredNotifs.map((notif) => (
              <NotifItem
                key={notif.id}
                notif={notif}
                avatarMap={avatarMap}
                onMarkRead={() => markReadMutation.mutate(notif.id)}
                onMarkUnread={() => markUnreadMutation.mutate(notif.id)}
                onDelete={() =>
                  confirmDeleteToast(
                    "Delete Notification?",
                    "This will permanently remove this alert from your hub.",
                    () => deleteNotifMutation.mutate(notif.id),
                  )
                }
                onClick={() => handleNotificationClick(notif)}
              />
            ))
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ─── NotifItem ────────────────────────────────────────────────────────────────
function NotifItem({
  notif,
  avatarMap,
  onMarkRead,
  onMarkUnread,
  onDelete,
  onClick,
}) {
  return (
    <div
      onClick={onClick}
      className={`p-6 border-b border-border transition-colors cursor-pointer ${
        !notif.is_read
          ? "bg-mauve-4 hover:bg-mauve-5"
          : "bg-mauve-3 hover:bg-mauve-4"
      }`}
    >
      <div className="flex gap-4 items-start">
        {/* Avatar / Icon */}
        <div className="relative shrink-0">
          {notif.sender_id || notif.sender?.id ? (
            <Avatar
              name={notif.sender?.name || "User"}
              src={
                avatarMap.get(notif.sender_id || notif.sender?.id) ?? undefined
              }
              size="md"
              className={!notif.is_read ? "ring-2 ring-mauve-6" : ""}
            />
          ) : (
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${notif.is_read ? "bg-muted" : "bg-primary/10"}`}
            >
              {getIconForType(notif.type)}
            </div>
          )}

          {/* Type badge overlay */}
          {(notif.sender_id || notif.sender?.id) && (
            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-card border border-border rounded-full flex items-center justify-center shadow-sm z-10">
              {React.cloneElement(getIconForType(notif.type), { size: 10 })}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start mb-1 gap-2">
            <h4
              className={`text-sm font-bold truncate ${notif.is_read ? "text-muted-foreground" : "text-foreground"}`}
            >
              {notif.title}
            </h4>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed font-normal">
            {safeRenderMessage(notif.message)}
          </p>
          <div className="mt-1.5 text-[12px] text-muted-foreground flex items-center gap-1.5">
            <span title={getFullDate(notif.created_at)} className="cursor-default">
              {getRelativeTime(notif.created_at)}
            </span>
            {notif.sender && (
              <>
                <span>•</span>
                <span>By {notif.sender.name}</span>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div
          className="flex flex-col items-end gap-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Dropdown
            placement="bottom-end"
            usePortal={true}
            popoverClassName="bg-card border border-border rounded-xl shadow-2xl z-[10001] popover-enter"
            trigger={({ isOpen }) => (
              <Button
                variant="ghost"
                size="icon-sm"
                className={`h-auto w-auto p-1.5 rounded-full hover:bg-muted transition-colors ${isOpen ? "bg-muted text-foreground" : "text-muted-foreground"}`}
              >
                <MoreHorizontal size={16} />
              </Button>
            )}
          >
            {({ close }) => (
              <div
                className="p-1 min-w-[160px] flex flex-col bg-card border border-border rounded-lg shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                {!notif.is_read ? (
                  <Button
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkRead();
                      close();
                    }}
                    className="h-auto justify-start flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-foreground hover:bg-muted transition-colors text-left"
                  >
                    <MailOpen size={14} /> Mark as read
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkUnread();
                      close();
                    }}
                    className="h-auto justify-start flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-foreground hover:bg-muted transition-colors text-left"
                  >
                    <MailWarning size={14} /> Mark as unread
                  </Button>
                )}
                <div className="h-px bg-border my-1" />
                <Button
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                    close();
                  }}
                  className="h-auto justify-start flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors text-left"
                >
                  <Trash2 size={14} /> Delete
                </Button>
              </div>
            )}
          </Dropdown>
          {!notif.is_read && (
            <Dot
              size="w-2 h-2"
              color="bg-primary/100"
              className="mr-1.5 mt-1"
            />
          )}
        </div>
      </div>
    </div>
  );
}
