import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

/**
 * Subscribes to a table's realtime broadcast channel and invalidates the
 * given query keys whenever a change is announced. The channel carries only
 * a change signal, never row contents — see docs/realtime-policy.md.
 */
export function useTableRealtime(table, { invalidateKeys = [] } = {}) {
  const queryClient = useQueryClient();
  const keysSignature = JSON.stringify(invalidateKeys);

  useEffect(() => {
    if (!table || invalidateKeys.length === 0) return undefined;

    let cancelled = false;
    const channel = supabase
      .channel(`${table}-changes`, { config: { private: true } })
      .on("broadcast", { event: "*" }, () => {
        invalidateKeys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      });

    supabase.realtime.setAuth().finally(() => {
      if (!cancelled) channel.subscribe();
    });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, keysSignature, queryClient]);
}
