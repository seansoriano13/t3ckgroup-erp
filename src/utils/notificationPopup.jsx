import React from "react";
import { toast } from "react-hot-toast";
import Avatar from "../components/Avatar";
import {
  Bell,
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
} from "lucide-react";
import { handleNotificationRoute } from "./notificationRouter";

const TYPE_ICONS = {
  TASK_GRADED: <CheckCircle2 size={18} className="text-green-500" />,
  TASK_REJECTED: <XCircle size={18} className="text-red-500" />,
  TASK_VERIFIED: <ShieldAlert size={18} className="text-primary" />,
  TASK_COMPLETED: <Trophy size={18} className="text-green-9" />,
  NEW_TASK_SUBMITTED: <Clock size={18} className="text-amber-500" />,
  TASK_APPROVED_BY_HEAD: <CheckCircle2 size={18} className="text-amber-600" />,
  GROUP_ASSIGNED: <Briefcase size={18} className="text-violet-9" />,
  GROUP_TASK_COMMENT: <MessageCircle size={18} className="text-violet-9" />,
  GROUP_TASK_READY_FOR_HR: <CheckCircle2 size={18} className="text-violet-10" />,
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

const getIconForType = (type) => TYPE_ICONS[type] ?? <Bell size={18} className="text-gray-9" />;

export const showNotificationPopup = (notif, navigate, user, avatarUrl) => {
  toast.custom(
    (t) => (
      <div
        onClick={() => {
          toast.dismiss(t.id);
          handleNotificationRoute(notif, user, navigate, () => {});
        }}
        className={`${
          t.visible
            ? "animate-in fade-in slide-in-from-top-5 slide-in-from-right-5"
            : "animate-out fade-out slide-out-to-top-5 slide-out-to-right-5 opacity-0"
        } bg-card shadow-2xl rounded-2xl p-4 flex gap-4 items-start min-w-[320px] max-w-[420px] pointer-events-auto border border-border transition-all duration-300 cursor-pointer hover:bg-muted/50 hover:border-mauve-6 mt-4 mr-4`}
      >
        <div className="relative shrink-0 mt-0.5">
          {notif.sender_id || notif.sender?.id ? (
            <Avatar
              name={notif.sender?.name || "System"}
              src={avatarUrl}
              size="md"
              className="ring-2 ring-mauve-4 shadow-sm"
            />
          ) : (
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-primary/10 ring-1 ring-primary/20 shadow-sm">
              {getIconForType(notif.type)}
            </div>
          )}
          {(notif.sender_id || notif.sender?.id) && (
            <div className="absolute -bottom-1 -right-1 w-[18px] h-[18px] bg-card border border-border rounded-full flex items-center justify-center shadow-sm z-10">
              {React.cloneElement(getIconForType(notif.type), { size: 10 })}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <h4 className="text-[14px] font-extrabold text-foreground truncate tracking-tight">
            {notif.title}
          </h4>
          <p className="text-[12px] text-muted-foreground font-medium leading-relaxed mt-0.5 line-clamp-2">
            {notif.message}
          </p>
        </div>
      </div>
    ),
    { duration: 5000, id: `notif-${notif.id}`, position: "top-right" }
  );
};
