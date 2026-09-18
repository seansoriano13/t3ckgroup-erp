import { useSyncExternalStore } from "react";

/**
 * Tracks a CSS media query's current match state, e.g. `useMediaQuery("(min-width: 1100px)")`.
 * `useSyncExternalStore` rather than a resize-listener effect so the value is
 * correct on the very first render (no flash of the narrow/wide layout).
 */
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
