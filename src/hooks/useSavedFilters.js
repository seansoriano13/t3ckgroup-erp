import { useCallback, useState } from "react";

/** A plain-data copy, so a stored or compared snapshot never shares references with live state. */
const cloneFilters = (filters) => JSON.parse(JSON.stringify(filters));

/**
 * The stored snapshot over the page's defaults, or null when nothing is saved.
 * The defaults' keys are the filter set: a snapshot saved before a filter
 * existed, or one holding null, falls back to the default for that key.
 */
function readSavedDefault(storageKey, defaults) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    return Object.fromEntries(
      Object.entries(defaults).map(([key, fallback]) => [key, stored[key] ?? fallback]),
    );
  } catch {
    return null;
  }
}

/**
 * "Save my current filters as my default for this page" (issue #205). Same
 * mechanism as the sidebar's remembered accordion state (ADR 0001): a
 * per-user, per-page localStorage key, read once at mount and written only
 * when the user explicitly saves or clears it — never on every filter change,
 * or the page would silently redefine "default" out from under them.
 */
export function useSavedFilters(pageKey, userId, defaults) {
  const storageKey = `erp_saved_filters_${pageKey}_${userId}`;

  // The stored snapshot itself (not just a flag), so the page can tell whether
  // the live filters have drifted from it and offer "Update default".
  const [savedDefault, setSavedDefault] = useState(() => readSavedDefault(storageKey, defaults));
  const [initial] = useState(() => savedDefault ?? defaults);

  const saveDefault = useCallback(
    (currentFilters) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(currentFilters));
        setSavedDefault(cloneFilters(currentFilters));
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

  /** True when the live filters no longer match the saved default. */
  const isDirty = (currentFilters) => {
    if (!savedDefault) return false;
    const live = cloneFilters(currentFilters);
    return Object.keys(savedDefault).some(
      (key) => JSON.stringify(live[key]) !== JSON.stringify(savedDefault[key]),
    );
  };

  return { initial, hasSavedDefault: savedDefault !== null, saveDefault, clearDefault, isDirty };
}
