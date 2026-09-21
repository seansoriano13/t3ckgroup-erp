import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

/**
 * Subscribes to a table's realtime broadcast channel and invalidates the
 * given query keys whenever a change is announced. The channel carries only
 * a change signal, never row contents — see docs/realtime-policy.md.
 *
 * `debounceMs` coalesces a burst of signals (a bulk write, or a stage move that
 * touches the row twice) into one invalidation at the end of it — for a
 * consumer whose refetch is a whole list rather than one row.
 */
export function useTableRealtime(table, { invalidateKeys = [], debounceMs = 0 } = {}) {
  const queryClient = useQueryClient();
  const keysSignature = JSON.stringify(invalidateKeys);

  useEffect(() => {
    if (!table || invalidateKeys.length === 0) return undefined;

    let cancelled = false;
    let timer = null;
    const invalidate = () => {
      invalidateKeys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    };
    const channel = supabase
      .channel(`${table}-changes`, { config: { private: true } })
      .on("broadcast", { event: "*" }, () => {
        if (!debounceMs) return invalidate();
        clearTimeout(timer);
        timer = setTimeout(invalidate, debounceMs);
      });

    supabase.realtime.setAuth().finally(() => {
      if (!cancelled) channel.subscribe();
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, keysSignature, debounceMs, queryClient]);
}
