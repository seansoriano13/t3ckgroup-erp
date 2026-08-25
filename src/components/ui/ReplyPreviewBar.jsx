import { X, Reply } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shown above the composer once a message has been picked to reply to
 * (via swipe on mobile or the hover reply icon on desktop).
 */
export default function ReplyPreviewBar({ replyingTo, onCancel, className }) {
  if (!replyingTo) return null;
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-muted/40",
        className,
      )}
    >
      <Reply size={14} className="text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-primary truncate">
          Replying to {replyingTo.authorName}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {replyingTo.content}
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        title="Cancel reply"
      >
        <X size={14} />
      </button>
    </div>
  );
}
