import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

/**
 * One broadcast channel per table, shared by every consumer mounted at once.
 * `supabase.channel(topic)` hands back the existing channel for a topic, so
 * two consumers of one table (the Procurement Queue and the request chat
 * open beside it) would otherwise share it unknowingly, and the first to
 * unmount would tear it down under the other. The channel is opened by the
 * first consumer and removed when the last one leaves.
 */
const channels = new Map();

function subscribeToTable(table, listener) {
  let entry = channels.get(table);
  if (!entry) {
    const listeners = new Set();
    const channel = supabase
      .channel(`${table}-changes`, { config: { private: true } })
      .on("broadcast", { event: "*" }, (payload) => {
        listeners.forEach((l) => l(payload));
      });
    entry = { channel, listeners, closed: false };
    channels.set(table, entry);
    const opened = entry;
    supabase.realtime.setAuth().finally(() => {
      if (!opened.closed) opened.channel.subscribe();
    });
  }
  entry.listeners.add(listener);

  const own = entry;
  return () => {
    own.listeners.delete(listener);
    if (own.listeners.size > 0) return;
    own.closed = true;
    if (channels.get(table) === own) channels.delete(table);
    supabase.removeChannel(own.channel);
  };
}

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

    let timer = null;
    const invalidate = () => {
      invalidateKeys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    };
    const unsubscribe = subscribeToTable(table, () => {
      if (!debounceMs) return invalidate();
      clearTimeout(timer);
      timer = setTimeout(invalidate, debounceMs);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, keysSignature, debounceMs, queryClient]);
}
