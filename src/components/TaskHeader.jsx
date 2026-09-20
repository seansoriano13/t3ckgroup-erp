import { ShieldCheck, MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const TaskHeader = ({ isEditing, isHrVerified, onClose, onOpenChat, extraButtons }) => (
  <div className="flex justify-between items-center px-6 py-4 border-b border-border bg-card shrink-0">
    <div className="flex items-center gap-3">
      <h2 className="text-xl font-extrabold tracking-tight text-foreground">
        {isEditing ? "Edit Task" : "Task Details"}
      </h2>
      {!isEditing && isHrVerified && (
        <span className="flex items-center gap-1.5 text-[10px] font-bold text-green-10 bg-green-50 px-2.5 py-1 rounded-full border border-green-200 uppercase tracking-widest">
          <ShieldCheck size={12} /> Verified
        </span>
      )}
    </div>
    <div className="flex items-center gap-2">
      {!isEditing && onOpenChat && (
        <Button
          onClick={onOpenChat}
          title="Open Conversation"
          variant="ghost" className="w-9"
        >
          <MessageCircle size={18} />
        </Button>
      )}
      {!isEditing && extraButtons}
      <Button
        onClick={onClose}
        variant="outline" className="w-9"
      >
        <X size={18} />
      </Button>
    </div>
  </div>
);

export default TaskHeader;
