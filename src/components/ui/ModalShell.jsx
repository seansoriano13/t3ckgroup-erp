import { useState } from "react";
import { ChevronRight, Maximize2, Minimize2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RECORD_MODAL_CLASS } from "@/components/ui/record-modal";

// Panel widths. `compact` is a short form or confirm step; `wide` is a record
// (IPAS, Transmittal, Packing List, Canvass). Expanded is the same for both:
// 16px inset on every side, so the panel grows in width and in height.
const SIZE_CLASS = {
  compact: "w-[680px]",
  wide: "w-[1100px]",
  // The record window: the RecordModal size, and the full screen on a phone.
  record: cn(
    RECORD_MODAL_CLASS,
    "max-sm:!top-0 max-sm:!left-0 max-sm:!translate-x-0 max-sm:!h-dvh max-sm:!w-screen max-sm:!max-w-none max-sm:rounded-none",
  ),
};

const EXPANDED_CLASS =
  "!top-4 !-translate-y-0 h-[calc(100vh-2rem)] max-h-none !w-[calc(100vw-2rem)] !max-w-none sm:!max-w-none";

const STORAGE_KEY = "modal-shell:expanded";

// The last Expand choice lasts for the session so a record opened after
// another one comes up the same size. Storage can throw (private window,
// blocked site data), so every access is guarded.
function readExpanded() {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeExpanded(value) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // no storage: the choice simply isn't remembered
  }
}

/**
 * The purchasing modal (DESIGN.md "Pages → Container rule"): the LogTask
 * layout as one shared shell. Header with a Purchasing badge and a breadcrumb
 * (`crumbs`: tab, then the action or record reference), optional
 * `headerActions` before Expand and Close, a scrolling body, and a gray footer
 * with "Esc to cancel", a Cancel button and the `actions` of the step.
 *
 * `title` is the dialog's accessible name; it defaults to the last crumb, so pass a
 * fuller one ("File TGIPAS_049?") where the crumb alone would not say what is asked.
 * A `wide` record carries `data-modal-shell="wide"`, so code that asks "is another
 * dialog open?" can tell the record itself from a dialog opened over it.
 *
 * `size`: "compact" (680px), "wide" (1100px) or "record" (the record window:
 * RecordModal size, filling the screen on a phone, with no footer bar and no
 * Expand; the X and Esc close it, and `actions`, `cancelLabel` and `footerStart`
 * are not drawn). `expandable` adds the Expand
 * button, which grows the panel to the full window in width and height.
 * Pass `onSubmit` to wrap body and footer in a form, so a `type="submit"`
 * action submits it. `cancelLabel={null}` hides Cancel for a record that only
 * closes. `footerStart` sits on the left of the footer, after the Esc hint.
 * `actionsRef` (a callback ref) hands back the footer's actions node, so a form
 * that owns its own buttons can portal them into the footer.
 */
export default function ModalShell({
  open,
  onOpenChange,
  crumbs = [],
  title,
  size = "compact",
  expandable = false,
  headerActions,
  actions,
  footerStart,
  actionsRef,
  cancelLabel = "Cancel",
  onSubmit,
  className,
  bodyClassName,
  children,
}) {
  const [expanded, setExpanded] = useState(readExpanded);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      writeExpanded(!prev);
      return !prev;
    });
  };

  const isRecord = size === "record";
  const close = () => onOpenChange?.(false);
  const heading = title || crumbs[crumbs.length - 1] || "Purchasing";
  const Frame = onSubmit ? "form" : "div";
  const frameProps = onSubmit ? { onSubmit } : {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        data-modal-shell={size}
        className={cn(
          "flex flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-[0_10px_40px_-10px_rgba(79,70,229,0.15)] transition-all duration-300 sm:max-w-none max-w-[95vw] max-h-[90vh]",
          SIZE_CLASS[size],
          // A record sits at 70 so its section drawer (75) and the small dialogs opened from it (80) stack above it.
          size === "wide" || isRecord ? "z-[70]" : "z-[80]",
          expandable && !isRecord && expanded && EXPANDED_CLASS,
          className,
        )}
      >
        <DialogTitle className="sr-only">{heading}</DialogTitle>

        <div className="flex shrink-0 items-center justify-between border-b border-mauve-3/40 px-5 pt-4 pb-2">
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
          >
            <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-foreground text-[9px] font-bold text-background">
              P
            </div>
            {crumbs.map((crumb, i) => (
              <span
                key={`${i}-${crumb}`}
                className="flex min-w-0 items-center gap-2"
              >
                <ChevronRight size={11} className="shrink-0 text-mauve-6" />
                <span
                  className={cn(
                    "truncate",
                    i === crumbs.length - 1
                      ? "font-medium text-muted-foreground/80"
                      : "text-muted-foreground",
                  )}
                >
                  {crumb}
                </span>
              </span>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            {expandable && !isRecord && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={toggleExpanded}
                className="h-auto w-auto rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                title={expanded ? "Collapse" : "Expand"}
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={close}
              className="h-auto w-auto rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
              aria-label="Close window"
            >
              <X size={15} />
            </Button>
          </div>
        </div>

        <Frame {...frameProps} className="flex min-h-0 flex-1 flex-col">
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3",
              bodyClassName,
            )}
          >
            {children}
          </div>

          {!isRecord && (
            <div className="flex shrink-0 items-center justify-between border-t border-border bg-muted/30 px-5 py-4">
              <div className="flex items-center gap-4 text-[10px] font-medium text-muted-foreground">
                <span className="hidden items-center gap-1.5 sm:flex">
                  <kbd className="rounded border border-border bg-muted/80 px-1.5 py-0.5 font-sans text-[9px] text-muted-foreground">
                    Esc
                  </kbd>
                  <span>to cancel</span>
                </span>
                {footerStart}
              </div>
              <div ref={actionsRef} className="flex items-center gap-2.5">
                {cancelLabel !== null && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={close}
                    className="h-9 rounded-xl px-4 text-[13px] font-bold text-muted-foreground/80 hover:text-foreground"
                  >
                    {cancelLabel}
                  </Button>
                )}
                {actions}
              </div>
            </div>
          )}
        </Frame>
      </DialogContent>
    </Dialog>
  );
}
