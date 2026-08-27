import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * A confirmation the app draws itself.
 *
 * `window.confirm` and `window.prompt` block the whole tab, ignore the theme,
 * and cannot say anything longer than a sentence — on a canvas whose actions
 * take other rows with them ("every move drawn to or from it goes too"), the
 * consequence is the part worth reading. Pass `children` to collect something
 * alongside the question, such as the reason a locked flow is being reopened.
 *
 * Controlled: the caller owns `open`, so the same dialog serves a queue of
 * different questions without remounting.
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
  children,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children}

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            size="lg"
            variant={tone === "destructive" ? "destructive" : "default"}
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
