import React from "react";
import { toast } from "react-hot-toast";
import Avatar from "../components/Avatar";
import NotificationTypeIcon from "../components/NotificationTypeIcon";
import { handleNotificationRoute } from "./notificationRouter";

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
              <NotificationTypeIcon type={notif.type} />
            </div>
          )}
          {(notif.sender_id || notif.sender?.id) && (
            <div className="absolute -bottom-1 -right-1 w-[18px] h-[18px] bg-card border border-border rounded-full flex items-center justify-center shadow-sm z-10">
              <NotificationTypeIcon type={notif.type} size={10} />
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
