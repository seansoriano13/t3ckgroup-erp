import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Both ribbons draw 44px tiles (`h-11`) flush with the bottom of this strip, so
// the arrows are the same height and sit on the tiles, not on a bracket label above them.
const ARROW_FADE = "pointer-events-none absolute bottom-0 flex h-11 w-12 items-center from-popover via-popover/85 to-transparent";
const ARROW_BTN =
  "pointer-events-auto flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground";

/**
 * A horizontally scrolling strip with no scrollbar: an arrow appears on
 * whichever side has more to reveal and pages the strip by most of its width.
 * The arrows overlay the strip's edges instead of sitting beside it, so showing
 * or hiding one never moves a tile. `data-stage-ribbon` keeps ←/→ on the
 * focused arrow from stepping to the next SOR.
 */
export default function StageRibbonScroller({ children, className }) {
  const scrollerRef = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // The strip's own width is fixed by the modal; it is the content that grows.
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure, children]);

  const page = (direction) => {
    const el = scrollerRef.current;
    if (!el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div data-stage-ribbon className={cn("relative", className)}>
      <div ref={scrollerRef} onScroll={measure} className="scrollbar-hide overflow-x-auto">
        {children}
      </div>
      {edges.left && (
        <div className={cn(ARROW_FADE, "left-0 justify-start bg-linear-to-r")}>
          <Button type="button" aria-label="Scroll stages left" onClick={() => page(-1)} variant="ghost" className={ARROW_BTN}>
            <ChevronLeft size={15} />
          </Button>
        </div>
      )}
      {edges.right && (
        <div className={cn(ARROW_FADE, "right-0 justify-end bg-linear-to-l")}>
          <Button type="button" aria-label="Scroll stages right" onClick={() => page(1)} variant="ghost" className={ARROW_BTN}>
            <ChevronRight size={15} />
          </Button>
        </div>
      )}
    </div>
  );
}
