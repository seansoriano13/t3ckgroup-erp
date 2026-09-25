import { ShieldCheck, MessageCircle, X } from "lucide-react";
import { Button } from "./ui/button";
import StatusBadge from "./StatusBadge";

// View mode leads with the task's own name — the thing the assignee came for —
// with status above it, the same order the Group Task modal uses.
const TaskHeader = ({ isEditing, isHrVerified, title, status, onClose, onOpenChat, extraButtons }) => (
  <div className="flex justify-between items-start gap-4 px-6 pt-5 pb-4 border-b border-border bg-card shrink-0">
    {isEditing ? (
      <h2 className="text-xl font-extrabold tracking-tight text-foreground mt-1.5">
        Edit Task
      </h2>
    ) : (
      <div className="min-w-0 flex-1 max-w-3xl mt-1">
        <div className="flex items-center gap-2 mb-2.5">
          {status && <StatusBadge status={status} />}
          {isHrVerified && (
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-green-10 bg-green-2 px-2.5 py-1 rounded-full border border-green-6 uppercase tracking-widest">
              <ShieldCheck size={12} /> Verified
            </span>
          )}
        </div>
        <h2 className="text-2xl font-black tracking-tight leading-tight text-foreground text-balance break-words">
          {title || "Task Details"}
        </h2>
      </div>
    )}
    <div className="flex items-center gap-2 shrink-0">
      {!isEditing && onOpenChat && (
        <Button
          variant="outline"
          size="icon"
          onClick={onOpenChat}
          title="Open Conversation"
          className="h-9 w-9 rounded-xl text-red-10 hover:bg-red-2 transition-all active:scale-95 border-red-3"
        >
          <MessageCircle size={18} />
        </Button>
      )}
      {!isEditing && extraButtons}
      <Button
        variant="outline"
        size="icon"
        onClick={onClose}
        className="h-9 w-9 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-all active:scale-95 border-transparent hover:border-border"
      >
        <X size={18} />
      </Button>
    </div>
  </div>
);

export default TaskHeader;
