import { Bookmark, BookmarkCheck, BookmarkPlus, X } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";

/** The one way to drop a saved default, the same in both saved states. */
function ClearDefaultButton({ onClear, size, className = "" }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      onClick={() => {
        onClear();
        toast.success("Saved default cleared");
      }}
      aria-label="Clear saved default filters"
      title="Clear saved default"
      className={`text-muted-foreground ${className}`}
    >
      <X aria-hidden="true" />
    </Button>
  );
}

/**
 * Two honest states for "remember these filters":
 * - nothing saved: an outlined bookmark button that reads as an action.
 * - saved: a confirmed status chip with an explicit reset affordance.
 *
 * `compact` keeps the icons and moves the words to the title and screen
 * readers, so the control fits at the end of a one-line FilterBar.
 */
export default function SaveDefaultButton({
  hasSavedDefault,
  isDirty = false,
  onSave,
  onClear,
  compact = false,
  className = "",
}) {
  const label = compact ? "sr-only" : undefined;

  if (hasSavedDefault && isDirty) {
    return (
      <div className={`inline-flex items-center gap-1 ${className}`}>
        <Button
          type="button"
          variant="outline"
          size={compact ? "icon-sm" : "sm"}
          onClick={() => {
            onSave();
            toast.success("Default updated");
          }}
          title="Replace your saved default with the current filters"
        >
          <BookmarkPlus aria-hidden="true" />
          <span className={label}>Update default</span>
        </Button>
        <ClearDefaultButton onClear={onClear} size="icon-sm" />
      </div>
    );
  }

  if (hasSavedDefault) {
    return (
      <div
        title={compact ? "Default saved" : undefined}
        className={`inline-flex h-7 items-center gap-1.5 rounded-lg border border-transparent bg-muted ${compact ? "pl-2" : "pl-2.5"} pr-1 text-[0.8rem] font-medium text-foreground ${className}`}
      >
        <BookmarkCheck className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className={label}>Default saved</span>
        <ClearDefaultButton onClear={onClear} size="icon-xs" className="hover:bg-background" />
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? "icon-sm" : "sm"}
      className={className}
      onClick={() => {
        onSave();
        toast.success("Filters saved as your default");
      }}
      title="Open this page with the current filters next time"
    >
      <Bookmark aria-hidden="true" />
      <span className={label}>Save filters as default</span>
    </Button>
  );
}
