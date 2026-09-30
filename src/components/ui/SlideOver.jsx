import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { Button } from "./button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "./drawer";

/**
 * The slide-over (DESIGN.md "Pages → Container rule"): one record picked from a
 * list, slid in from the right over it.
 *
 * Header: the record's identity (`icon`, a `crumb` that closes back to the
 * list, `identity(record)` → `{ ref, title, badge, subtitle }`), a position
 * count with previous / next (also J / K), an "Open full" button when
 * `onOpenFull` is given, and Close. `children(record)` renders a
 * `SlideOverBody` and, usually, a `SlideOverFooter`.
 *
 * The last record stays rendered while the panel slides shut, and focus lands
 * on the panel itself rather than its first button, so a bare Enter reaches a
 * decision shortcut instead of clicking the crumb.
 */
export default function SlideOver({ record, icon: Icon, crumb, identity, index, total, onStep, onClose, onOpenFull, children }) {
  const [shown, setShown] = useState(record);
  if (record && record !== shown) setShown(record);
  const current = record || shown;
  const focusRef = useRef(null);

  useEffect(() => {
    if (!record) return;
    const onKey = (e) => {
      const t = e.target;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" && index < total - 1) onStep(1);
      if (e.key === "k" && index > 0) onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [record, index, total, onStep]);

  const who = current ? identity(current) : null;

  return (
    <Drawer open={!!record} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="w-[560px] max-sm:w-full" initialFocus={focusRef}>
        {current && (
          <div ref={focusRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
            <div className="flex items-start gap-3 border-b border-border px-6 py-5">
              {Icon && (
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
                  <Icon size={18} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Button variant="link" size="xs" className="h-auto p-0 text-[11px] text-muted-foreground" onClick={onClose}>
                    {crumb}
                  </Button>
                  <ChevronRight size={11} />
                  <span className="font-mono">{who.ref}</span>
                </p>
                <div className="mt-0.5 flex items-center gap-2">
                  <DrawerTitle className="line-clamp-2 text-base font-bold">{who.title}</DrawerTitle>
                  {who.badge}
                </div>
                {who.subtitle && <DrawerDescription className="mt-0.5 text-xs">{who.subtitle}</DrawerDescription>}
              </div>
              <span className="hidden pt-1.5 font-mono text-[11px] text-muted-foreground sm:inline">
                {index + 1} / {total}
              </span>
              <Button variant="outline" size="icon-sm" disabled={index <= 0} onClick={() => onStep(-1)} aria-label="Previous record (K)">
                <ChevronLeft size={14} />
              </Button>
              <Button variant="outline" size="icon-sm" disabled={index >= total - 1} onClick={() => onStep(1)} aria-label="Next record (J)">
                <ChevronRight size={14} />
              </Button>
              {onOpenFull && (
                <Button variant="ghost" size="icon-sm" onClick={() => onOpenFull(current)} aria-label="Open full">
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

/** The scrolling middle of a slide-over. */
export function SlideOverBody({ children }) {
  return <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5">{children}</div>;
}

/** The decision, pinned to the bottom of a slide-over. */
export function SlideOverFooter({ children }) {
  return <div className="space-y-3 border-t border-border bg-muted/30 px-6 py-4">{children}</div>;
}
