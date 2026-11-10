// Plain helpers shared by the IPAS edit form's typed fields (#581).

export const NONE = "__none__";
export const blank = (value) => value === "" || value === null || value === undefined || String(value).trim() === "";
export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Scroll an element into view, smoothly unless the viewer asked for less motion. */
export function scrollIntoViewGently(el, block = "center") {
  el?.scrollIntoView?.({ block, behavior: reducedMotion() ? "auto" : "smooth" });
}

/** Scroll a control into view and put the cursor in it. */
export function focusField(id) {
  const el = document.getElementById(id);
  if (!el) return;
  scrollIntoViewGently(el);
  el.focus({ preventScroll: true });
}

// A required box still empty gets a soft amber edge and a quiet "Needed" tag.
export const NEEDED_BOX = "border-amber-7 bg-amber-a1";

export const GRID = "grid gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-4";
