import { Bookmark, BookmarkCheck, BookmarkPlus, X } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";

/**
 * Two honest states for "remember these filters":
 * - nothing saved: an outlined bookmark button that reads as an action.
 * - saved: a confirmed status chip with an explicit reset affordance.
 */
export default function SaveDefaultButton({
  hasSavedDefault,
  isDirty = false,
  onSave,
  onClear,
  className = "",
}) {
  if (hasSavedDefault && isDirty) {
    return (
      <div className={`inline-flex items-center gap-1 ${className}`}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onSave();
            toast.success("Default updated");
          }}
          title="Replace your saved default with the current filters"
        >
          <BookmarkPlus aria-hidden="true" />
          Update default
        </Button>
        <button
          type="button"
          onClick={() => {
            onClear();
            toast.success("Saved default cleared");
          }}
          aria-label="Clear saved default filters"
          title="Clear saved default"
          className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (hasSavedDefault) {
    return (
      <div
        className={`inline-flex h-7 items-center gap-1.5 rounded-lg border border-transparent bg-muted pl-2.5 pr-1 text-[0.8rem] font-medium text-foreground ${className}`}
      >
        <BookmarkCheck className="size-3.5 text-primary" aria-hidden="true" />
        <span>Default saved</span>
        <button
          type="button"
          onClick={() => {
            onClear();
            toast.success("Saved default cleared");
          }}
          aria-label="Clear saved default filters"
          title="Clear saved default"
          className="grid size-5 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => {
        onSave();
        toast.success("Filters saved as your default");
      }}
      title="Open this page with the current filters next time"
    >
      <Bookmark aria-hidden="true" />
      Save filters as default
    </Button>
  );
}
