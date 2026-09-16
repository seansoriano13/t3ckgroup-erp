import { useCallback, useState } from "react";

/**
 * "Save my current filters as my default for this page" (issue #205). Same
 * mechanism as the sidebar's remembered accordion state (ADR 0001): a
 * per-user, per-page localStorage key, read once at mount and written only
 * when the user explicitly saves or clears it — never on every filter change,
 * or the page would silently redefine "default" out from under them.
 */
export function useSavedFilters(pageKey, userId, defaults) {
  const storageKey = `erp_saved_filters_${pageKey}_${userId}`;

  const [initial] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch {
      return defaults;
    }
  });

  const [hasSavedDefault, setHasSavedDefault] = useState(() => {
    try {
      return localStorage.getItem(storageKey) !== null;
    } catch {
      return false;
    }
  });

  const saveDefault = useCallback(
    (currentFilters) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(currentFilters));
        setHasSavedDefault(true);
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const clearDefault = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
      setHasSavedDefault(false);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return { initial, hasSavedDefault, saveDefault, clearDefault };
}
