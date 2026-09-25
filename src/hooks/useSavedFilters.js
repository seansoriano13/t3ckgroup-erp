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

  // The stored snapshot itself (not just a flag), so the UI can tell whether
  // the live filters have drifted from it and offer "Update default".
  const [savedDefault, setSavedDefault] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const hasSavedDefault = savedDefault !== null;

  const saveDefault = useCallback(
    (currentFilters) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(currentFilters));
        setSavedDefault(JSON.parse(JSON.stringify(currentFilters)));
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const clearDefault = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
      setSavedDefault(null);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return { initial, hasSavedDefault, savedDefault, saveDefault, clearDefault };
}

/** True when the live filters no longer match the stored snapshot. */
export function isDefaultDirty(savedDefault, currentFilters) {
  if (!savedDefault) return false;
  const norm = JSON.parse(JSON.stringify(currentFilters));
  return Object.keys(norm).some(
    (k) => JSON.stringify(norm[k]) !== JSON.stringify(savedDefault[k]),
  );
}
