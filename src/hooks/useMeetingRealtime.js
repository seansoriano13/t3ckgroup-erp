import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTableRealtime } from "./useTableRealtime";
import { ACTIVITY_QUERY_ROOTS, refreshActivityQueries } from "./activityQueries";

/**
 * Activities are live (#627, docs/realtime-policy.md): all three tables broadcast a change
 * signal from a trigger, and `useTableRealtime` hands it to `refreshActivityQueries`.
 *
 * Every Activity query (the Calendar, My Activities, the form's Venue preview,
 * the Approval Center queue and its badge) keys under one of MEETING_QUERY_ROOTS. One filing
 * signals on all three tables and every mounted screen listens, so the refresh waits out the
 * burst and refetches each list once (#1090). The shared hook keeps one channel per table
 * across every screen mounted at once.
 */
export const MEETING_TABLES = ["meeting_requests", "meeting_request_participants", "meeting_request_days"];
export const MEETING_QUERY_ROOTS = ACTIVITY_QUERY_ROOTS.map((root) => [root]);

/** `enabled: false` keeps the channels closed, for a caller that only needs them for some viewers. */
export function useMeetingRealtime({ enabled = true } = {}) {
  const queryClient = useQueryClient();
  const onSignal = useCallback(() => refreshActivityQueries(queryClient), [queryClient]);
  useTableRealtime(enabled ? MEETING_TABLES[0] : null, { onSignal });
  useTableRealtime(enabled ? MEETING_TABLES[1] : null, { onSignal });
  useTableRealtime(enabled ? MEETING_TABLES[2] : null, { onSignal });
}
