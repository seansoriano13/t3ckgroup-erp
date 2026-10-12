import { useCallback, useMemo, useState } from "react";

/**
 * Client-side paging for a list. Clamps the page when the list shrinks (a
 * filter narrowed it) so the user never lands on an empty page; changing the
 * page size returns to page 1.
 */
export function usePaging(items, { initialPageSize = 25 } = {}) {
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [page, setPage] = useState(1);

  const total = items.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);

  const rows = useMemo(
    () => items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [items, currentPage, pageSize],
  );

  const setPageSize = useCallback((n) => {
    setPageSizeState(Number(n));
    setPage(1);
  }, []);

  return { rows, total, page: currentPage, pageSize, totalPages, setPage, setPageSize };
}
