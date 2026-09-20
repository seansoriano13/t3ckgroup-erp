import { Dialog, DialogContent } from "../ui/dialog";
import { X, ChevronDown } from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";

/**
 * A reusable modal wrapper for HR management forms (Employees, Categories, etc.)
 */
export default function HRFormModal({
  isOpen,
  onClose,
  title,
  subtitle,
  icon: Icon,
  iconColor = "text-mauve-9",
  /** Short text (1-3 chars) for the header chip instead of an icon — e.g. "OPP". */
  badge,
  formId,
  isPending,
  submitLabel = "Save Changes",
  children,
}) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 p-0 gap-0 z-70 shadow-[0_10px_40px_-10px_rgba(79,70,229,0.15)] flex flex-col transition-all duration-300 w-full max-w-[95vw] sm:max-w-[680px] rounded-2xl max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            {badge ? (
              <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-primary text-[9px] font-bold text-primary-foreground shrink-0">
                {badge.toUpperCase()}
              </div>
            ) : (
              Icon && (
                <div
                  className={`w-[18px] h-[18px] rounded flex items-center justify-center bg-primary/10 ${iconColor} shrink-0`}
                >
                  <Icon size={11} strokeWidth={2.5} />
                </div>
              )
            )}
            <ChevronDown
              size={11}
              className="text-muted-foreground/50 -rotate-90"
            />
            <span className="font-medium text-muted-foreground/80">
              {title}
            </span>
            {subtitle && (
              <>
                <span className="text-muted-foreground/30">•</span>
                <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/60">
                  {subtitle}
                </span>
              </>
            )}
          </div>
          <Button
            onClick={onClose}
            variant="ghost" size="icon-xs"
          >
            <X size={15} />
          </Button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 min-h-0">{children}</div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <kbd className="px-1.5 py-0.5 bg-muted/80 border border-border rounded font-sans text-[9px]">
              Esc
            </kbd>
            <span>to close</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              onClick={onClose}
              variant="ghost" className="h-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={isPending}
              variant="default"
            >
              {isPending ? <Spinner size="sm" /> : null}
              {isPending ? "Saving..." : submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
