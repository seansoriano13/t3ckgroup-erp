import { useCallback, useState } from "react";

/**
 * A Set of ids that can be flipped one at a time: which rows of a list are
 * expanded, say. Returns `[set, toggle]`; `toggle(id)` adds the id when absent,
 * removes it when present, and always hands React a new Set.
 *
 * @template T
 * @returns {[Set<T>, (id: T) => void]}
 */
export function useToggleSet() {
  const [set, setSet] = useState(() => new Set());
  const toggle = useCallback((id) => {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  return [set, toggle];
}
