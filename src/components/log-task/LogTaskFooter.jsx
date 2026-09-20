import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/Spinner";

export default function LogTaskFooter({
  createMore,
  setCreateMore,
  isSubmitting,
  onClose,
}) {
  return (
    <div className="px-5 py-4 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer group">
          <div className="relative">
            <input
              type="checkbox"
              checked={createMore}
              onChange={(e) => setCreateMore(e.target.checked)}
              className="sr-only"
            />
            <div
              className={`w-8 h-4.5 rounded-full transition-colors ${createMore ? "bg-primary" : "bg-mauve-5 group-hover:bg-mauve-6"}`}
            />
            <div
              className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-card rounded-full transition-transform ${createMore ? "translate-x-3.5" : "translate-x-0"}`}
            />
          </div>
          <span className="text-[11px] font-semibold text-muted-foreground group-hover:text-foreground transition-colors">
            Create more
          </span>
        </label>

        <div className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground font-medium">
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-muted/80 border border-border rounded text-muted-foreground font-sans text-[9px]">
              Ctrl
            </kbd>
            <span>+</span>
            <kbd className="px-1.5 py-0.5 bg-muted/80 border border-border rounded text-muted-foreground font-sans text-[9px]">
              Enter
            </kbd>
            <span className="ml-0.5">to save</span>
          </div>
          <div className="w-[3px] h-[3px] rounded-full bg-mauve-5" />
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted/80 border border-border rounded text-muted-foreground font-sans text-[9px]">
              Esc
            </kbd>
            <span>to cancel</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-[13px] font-bold text-muted-foreground/80 hover:text-foreground h-9 rounded-xl px-4"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          form="log-task-form"
          disabled={isSubmitting}
          className="h-9 px-6 rounded-xl shadow-lg shadow-primary/20"
        >
          {isSubmitting ? (
            <>
              <Spinner size="sm" />
              <span>Logging…</span>
            </>
          ) : (
            <>
              <Check size={16} strokeWidth={3} />
              <span>Log Task</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
