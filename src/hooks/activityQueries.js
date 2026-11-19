import { useQuery } from "@tanstack/react-query";
import { calendarService } from "../services/calendarService";

/**
 * The Activity pages' shared reads (#1090, tracker E1).
 *
 * One key per list: the Calendar and the New Activity form both read
 * `calendar_entries` through `useCalendarEntries`, so a range asked for twice is one request.
 * And one refresh per change: `refreshActivityQueries` is the single way to say "an Activity
 * changed", for a local mutation and for a realtime signal alike. Calls that land close together
 * (one filing writes three tables and fires three signals, and four screens each listen) are
 * folded into one invalidation, so each visible list is fetched once, not once per caller.
 */

/** Every Activity query keys under one of these roots (see useMeetingRealtime). */
export const ACTIVITY_QUERY_ROOTS = ["calendar-entries", "meeting-requests"];

/** How long a change waits for company before the lists refetch. */
export const ACTIVITY_REFRESH_WINDOW_MS = 250;

export const calendarEntriesKey = (from, to, includePending = false) => ["calendar-entries", from, to, includePending];

/** The Calendar's one read, keyed by its range. `enabled: false` waits (the form with no valid date yet). */
export function useCalendarEntries({ from, to, includePending = false, enabled = true }) {
  return useQuery({
    queryKey: calendarEntriesKey(from, to, includePending),
    queryFn: () => calendarService.fetchEntries({ from, to, includePending }),
    enabled,
  });
}

const isActivityQuery = (query) => ACTIVITY_QUERY_ROOTS.includes(query.queryKey[0]);

// One waiting timer per client; a second request inside the window joins it.
const waiting = new WeakMap();

/** Refetches every on-screen Activity list once, after a short quiet window. Safe to call from many places. */
export function refreshActivityQueries(queryClient, { windowMs = ACTIVITY_REFRESH_WINDOW_MS } = {}) {
  clearTimeout(waiting.get(queryClient));
  const timer = setTimeout(() => {
    waiting.delete(queryClient);
    queryClient.invalidateQueries({ predicate: isActivityQuery });
  }, windowMs);
  waiting.set(queryClient, timer);
}
