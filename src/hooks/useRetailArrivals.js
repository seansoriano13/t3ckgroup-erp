import { useEffect, useRef, useState } from "react";
import { useTableRealtime } from "./useTableRealtime";

/** How long a newly arrived Retail Order stays highlighted. */
export const ARRIVAL_HIGHLIGHT_MS = 6000;

/**
 * Classes for an element that flashes while its order is in the arrived set:
 * pair with `data-arrived={arrivals.has(id) || undefined}`.
 */
export const ARRIVAL_HIGHLIGHT_CLASS =
  "duration-300 ease-out-expo data-[arrived]:bg-green-a4";

/**
 * Keeps the Retail screen current without anyone touching it (#455).
 *
 * `retail_orders` broadcasts a change signal whenever the sync writes a row, and
 * this refetches the `["retailOrders"]` query when it arrives, debounced because
 * one sync can write a few hundred rows in a burst. It returns the ids of the
 * orders that showed up *after* the first load — a "just arrived" set the screen
 * can highlight for a few seconds. Whatever was on screen at first load is the
 * baseline, not an arrival.
 *
 * @param {{ id: string }[]} orders the orders on screen
 * @param {boolean} ready whether `orders` is the loaded list, not the empty placeholder
 * @returns {Set<string>} ids of orders that arrived in the last few seconds
 */
export function useRetailArrivals(orders, ready) {
  useTableRealtime("retail_orders", { invalidateKeys: [["retailOrders"]], debounceMs: 800 });

  const seen = useRef(null);
  const timers = useRef(new Set());
  const [arrived, setArrived] = useState(() => new Set());

  useEffect(() => {
    if (!ready) return;
    if (seen.current === null) {
      seen.current = new Set(orders.map((order) => order.id));
      return;
    }
    const fresh = orders.map((order) => order.id).filter((id) => !seen.current.has(id));
    if (fresh.length === 0) return;

    fresh.forEach((id) => seen.current.add(id));
    setArrived((previous) => new Set([...previous, ...fresh]));
    // Not cleared when `orders` changes again: each arrival expires on its own clock.
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setArrived((previous) => {
        const next = new Set(previous);
        fresh.forEach((id) => next.delete(id));
        return next;
      });
    }, ARRIVAL_HIGHLIGHT_MS);
    timers.current.add(timer);
  }, [orders, ready]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return arrived;
}
