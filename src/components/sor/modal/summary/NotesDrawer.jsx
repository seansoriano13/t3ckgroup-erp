/**
 * SOR modal layout. The notes pop-out (liked
 * in round 1, since dropped with its layout): a drawer that
 * slides over the right of the modal body, opened from a header button, so
 * the notes don't cost a permanent column. Parent must be `relative`.
 */
import { MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function NotesButton({ p, open, onToggle, className }) {
  return (
    <Button type="button" variant={open ? "secondary" : "outline"} size="sm" onClick={onToggle} aria-expanded={open} className={cn("gap-1.5", className)}>
      <MessageSquare size={13} />
      Notes
      <span className="rounded-full bg-mauve-4 px-1.5 text-[10px] font-bold tabular-nums text-mauve-11">{p.notes.length}</span>
    </Button>
  );
}

export default function NotesDrawer({ p, open, onClose }) {
  return (
    <div
      className={cn(
        "absolute inset-y-0 right-0 z-30 w-full max-w-[400px] border-l border-border/60 bg-popover shadow-[-12px_0_32px_-16px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-out-expo",
        open ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
      inert={!open}
    >
      {open && (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close notes"
          className="absolute top-2 -left-11 z-10 rounded-full bg-popover text-muted-foreground shadow-sm"
        >
          <X size={14} />
        </Button>
      )}
      {open && p.chatColumn}
    </div>
  );
}
