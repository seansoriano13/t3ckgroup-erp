import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";

/**
 * Which tabs have been opened at least once, so Journey/Items/Details fetch
 * only the first time they're switched to and stay mounted after — switching
 * away and back must not refetch or drop in-progress state.
 */
export function useOpenedTabs(initialTab) {
  const [opened, setOpened] = useState(() => new Set([initialTab]));

  const markOpened = useCallback((tab) => {
    setOpened((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, []);

  const hasOpened = useCallback((tab) => opened.has(tab), [opened]);

  return { markOpened, hasOpened };
}

/**
 * One query per non-Now tab. `enabled` waits on `hasOpened(tab)` rather than
 * the tab being active, so React Query's own cache (not remount) is what
 * keeps a revisit from refetching.
 */
export function useSorModalData({ tab, opportunityId, queryFn, hasOpened }) {
  return useQuery({
    queryKey: ["sorModalTab", tab, opportunityId],
    queryFn,
    enabled: !!opportunityId && hasOpened(tab),
  });
}
