import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const CUE = 24;

/**
 * A `<nav>` that scrolls sideways and fades the edge that still has something
 * behind it, so a cut-off tab is never invisible (same cue as TabGroup).
 */
export default function ScrollCueNav({ className, children, ...props }) {
  const scrollerRef = useRef(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const mask =
    fade.left || fade.right
      ? `linear-gradient(to right, ${fade.left ? "transparent" : "#000"}, #000 ${CUE}px, #000 calc(100% - ${CUE}px), ${fade.right ? "transparent" : "#000"})`
      : undefined;

  return (
    <nav
      ref={scrollerRef}
      onScroll={measure}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      className={cn("scrollbar-hide overflow-x-auto", className)}
      {...props}
    >
      {children}
    </nav>
  );
}
