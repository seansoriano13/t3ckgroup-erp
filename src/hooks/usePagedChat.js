import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

export const CHAT_PAGE_SIZE = 30;

/**
 * A Chat that loads its newest Messages first and older ones on demand, so a
 * long Chat costs what is on screen rather than what was ever said.
 *
 * `fetchPage({ before, limit })` returns up to `limit` Messages oldest-first —
 * the newest ones strictly older than the `before` timestamp (the newest of
 * all when `before` is null). A full page means there may be more behind it.
 *
 * `messages` is every loaded page flattened oldest-first. A realtime
 * invalidation refetches only the pages loaded so far, so reactions and
 * read-receipts on loaded Messages stay live while a thread nobody has
 * scrolled stays at one page.
 */
export function usePagedChat({ queryKey, fetchPage, enabled = true, pageSize = CHAT_PAGE_SIZE }) {
  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: null,
    queryFn: ({ pageParam }) => fetchPage({ before: pageParam, limit: pageSize }),
    getNextPageParam: (lastPage) =>
      lastPage.length >= pageSize ? lastPage[0]?.created_at : undefined,
  });

  const messages = useMemo(() => {
    const seen = new Set();
    const out = [];
    // pages[0] is the newest page; walk oldest page first, dropping repeats
    // that a shared timestamp at a page edge can produce.
    for (const page of [...(query.data?.pages || [])].reverse()) {
      for (const m of page) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(m);
      }
    }
    return out;
  }, [query.data]);

  return {
    messages,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    hasMore: !!query.hasNextPage,
    isFetchingMore: query.isFetchingNextPage,
    loadMore: query.fetchNextPage,
  };
}
