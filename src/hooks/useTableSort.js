import { useCallback, useMemo, useState } from "react";

const isBlank = (v) => v == null || v === "";

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Click-a-header sorting for a table's rows. `accessors` maps a column's
 * sortKey to the value to compare (a number, Date or string); blanks always
 * sort last. Clicking a column sorts it ascending, again descending, a third
 * time returns the rows to their original order.
 */
export function useTableSort(rows, accessors) {
  const [sort, setSort] = useState({ key: null, dir: "asc" });

  const toggle = useCallback((key) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return { key: null, dir: "asc" };
    });
  }, []);

  const sorted = useMemo(() => {
    const get = sort.key && accessors[sort.key];
    if (!get) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((x, y) => {
      const a = get(x);
      const b = get(y);
      if (isBlank(a) && isBlank(b)) return 0;
      if (isBlank(a)) return 1;
      if (isBlank(b)) return -1;
      return compare(a, b) * factor;
    });
  }, [rows, accessors, sort]);

  return { sorted, sort, toggle };
}
