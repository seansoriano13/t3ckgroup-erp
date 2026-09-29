import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDate } from "../utils/formatDate"

/**
 * Why a held, cancelled or closed-off task opens read-only (#396): held since
 * when (`held_at`, stamped by the hold itself — never `edited_at`), or the
 * reason it was cancelled (`cancel_reason`, written by Start fresh, Revert
 * and Remove progress). Shared by the individual and Group Task modals so
 * the two can't word it differently.
 */
export default function ReadOnlyTaskBanner({ held, heldAt, cancelReason, noun = "Task", className }) {
  const detail = held
    ? heldAt
      ? `Held since ${formatDate(heldAt)}. Only a Resume brings it back.`
      : "Held. Only a Resume brings it back."
    : cancelReason || "Cancelled."

  return (
    <div
      className={cn(
        "bg-muted/40 border border-border rounded-xl p-4 flex items-center gap-3 text-muted-foreground shadow-sm",
        className,
      )}
    >
      <div className="bg-mauve-4 p-2 rounded-lg">
        <AlertTriangle size={20} className="text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-black uppercase tracking-tight text-foreground">
          {noun} {held ? "On Hold" : "Cancelled"}
        </p>
        <p className="text-xs font-bold opacity-80">{detail} This task is read-only.</p>
      </div>
    </div>
  )
}
