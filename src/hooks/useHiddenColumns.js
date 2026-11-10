import { useCallback, useState } from "react";

/**
 * The columns a Purchasing list hides, remembered on this browser under
 * `storageKey` (build it per employee). `defaults` are hidden for someone who
 * has never chosen; a saved choice, even "show all" (an empty list), is kept.
 * `known` is every column key the list has: saved keys it no longer has are
 * dropped. Blocked or broken storage never breaks the page.
 */
function read(storageKey, defaults, known) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return defaults;
    const stored = JSON.parse(raw);
    if (!Array.isArray(stored)) return defaults;
    return stored.filter((key) => (known ? known.includes(key) : typeof key === "string"));
  } catch {
    return defaults;
  }
}

export function useHiddenColumns(storageKey, { defaults = [], known = null } = {}) {
  const [hidden, setHidden] = useState(() => read(storageKey, defaults, known));
  const show = useCallback((key) => !hidden.includes(key), [hidden]);
  const toggle = (key) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  return { hidden, show, toggle };
}
