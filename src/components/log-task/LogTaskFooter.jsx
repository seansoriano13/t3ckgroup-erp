import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/Spinner";
import { SwitchField } from "@/components/ui/ToggleField";


export default function LogTaskFooter({
  createMore,
  setCreateMore,
  isSubmitting,
  onClose,
}) {
  return (
    <div className="px-5 py-4 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-4">
        <SwitchField variant="inline" label="Create more" checked={createMore} onCheckedChange={setCreateMore} />

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
