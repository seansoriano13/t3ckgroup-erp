import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { relativeAge } from "../../../utils/approvalItems.js";
import { StatusPill } from "./ApprovalParts";

/**
 * The review sheet: one request, slid in from the right over its queue.
 *
 * Head: breadcrumb back to the queue, the request's title and state, previous /
 * next through the queue (also J / K), and the full-details view when there is
 * one. The page renders the body and decision through `children(item)`, so a
 * task and a leave request can review differently inside the same frame.
 *
 * The last item stays rendered while the sheet slides shut, and focus lands on
 * the sheet itself rather than its first button, so a bare Enter reaches the
 * decision shortcut instead of clicking the breadcrumb.
 */
export function ApprovalSheet({ item, queueLabel, queueIcon: QueueIcon, index, total, onStep, onClose, onOpenDetails, children }) {
  const [shown, setShown] = useState(item);
  if (item && item !== shown) setShown(item);
  const current = item || shown;
  const focusRef = useRef(null);

  useEffect(() => {
    if (!item) return;
    const onKey = (e) => {
      const t = e.target;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" && index < total - 1) onStep(1);
      if (e.key === "k" && index > 0) onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, index, total, onStep]);

  return (
    <Drawer open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="w-[560px]" initialFocus={focusRef}>
        {current && (
          <div ref={focusRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
            <div className="flex items-start gap-3 border-b border-border px-6 py-5">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
                <QueueIcon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Button variant="link" size="xs" className="h-auto p-0 text-[11px] text-muted-foreground" onClick={onClose}>
                    {queueLabel}
                  </Button>
                  <ChevronRight size={11} />
                  <span className="font-mono">{current.ref}</span>
                </p>
                <div className="mt-0.5 flex items-center gap-2">
                  <DrawerTitle className="line-clamp-2 text-base font-bold">{current.title}</DrawerTitle>
                  <StatusPill item={current} />
                </div>
                <DrawerDescription className="mt-0.5 text-xs">submitted {relativeAge(current.submittedAt)}</DrawerDescription>
              </div>
              <span className="hidden pt-1.5 font-mono text-[11px] text-muted-foreground sm:inline">
                {index + 1} / {total}
              </span>
              <Button variant="outline" size="icon-sm" disabled={index <= 0} onClick={() => onStep(-1)} aria-label="Previous request (K)">
                <ChevronLeft size={14} />
              </Button>
              <Button variant="outline" size="icon-sm" disabled={index >= total - 1} onClick={() => onStep(1)} aria-label="Next request (J)">
                <ChevronRight size={14} />
              </Button>
              {onOpenDetails && (
                <Button variant="ghost" size="icon-sm" onClick={() => onOpenDetails(current)} aria-label="Full details and activity">
                  <Maximize2 size={14} />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
                <X size={16} />
              </Button>
            </div>
            {children(current)}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/** The scrolling middle of the sheet. */
export function SheetBody({ children }) {
  return <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5">{children}</div>;
}

/** The decision, pinned to the bottom of the sheet. */
export function SheetFooter({ children }) {
  return <div className="space-y-3 border-t border-border bg-muted/30 px-6 py-4">{children}</div>;
}
