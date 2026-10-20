import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";
import { APPROVE_CLASS } from "@/components/ui/approveClass";

/**
 * A confirmation the app draws itself.
 *
 * `window.confirm` and `window.prompt` block the whole tab, ignore the theme,
 * and cannot say anything longer than a sentence — on a canvas whose actions
 * take other rows with them ("every move drawn to or from it goes too"), the
 * consequence is the part worth reading. Pass `children` to collect something
 * alongside the question, such as the reason a locked flow is being reopened.
 *
 * It sits at z-80 so it shows above a ModalShell record (z-70) and that record's
 * section drawer (z-75); a caller may pass its own `z-[n]` in `className`.
 *
 * Controlled: the caller owns `open`, so the same dialog serves a queue of
 * different questions without remounting. `tone`: "destructive" (red confirm),
 * "approve" (the green Approve, as its button on the page), or the default.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  confirmDisabled = false,
  className,
  footerClassName,
  children,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("z-[80] sm:max-w-md", className)}>
        {/* `pr-10` keeps the title clear of DialogContent's own close button,
            which is absolutely positioned at top-2 right-2 — on a dialog with
            roomier padding it otherwise sits on top of the title text and
            reads as unclickable. */}
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children}

        <DialogFooter className={footerClassName}>
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            size="lg"
            variant={tone === "destructive" ? "destructive" : "default"}
            className={cn(tone === "approve" && APPROVE_CLASS)}
            disabled={confirmDisabled}
            onClick={() => {
              onConfirm?.();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
