import { useTableRealtime } from "./useTableRealtime";

/**
 * Activities are live (#627, docs/realtime-policy.md): all three tables broadcast a change
 * signal from a trigger, and `useTableRealtime` turns it into a refetch.
 *
 * Every Activity query (the Calendar, My Activities, the form's Venue preview,
 * the Approval Center queue and its badge) keys under one of MEETING_QUERY_ROOTS, so one
 * invalidation per root refreshes all of them. The shared hook keeps one channel per table
 * across every screen mounted at once.
 */
export const MEETING_TABLES = ["meeting_requests", "meeting_request_participants", "meeting_request_days"];
export const MEETING_QUERY_ROOTS = [["calendar-entries"], ["meeting-requests"]];

/** `enabled: false` keeps the channels closed, for a caller that only needs them for some viewers. */
export function useMeetingRealtime({ enabled = true } = {}) {
  useTableRealtime(enabled ? MEETING_TABLES[0] : null, { invalidateKeys: MEETING_QUERY_ROOTS });
  useTableRealtime(enabled ? MEETING_TABLES[1] : null, { invalidateKeys: MEETING_QUERY_ROOTS });
  useTableRealtime(enabled ? MEETING_TABLES[2] : null, { invalidateKeys: MEETING_QUERY_ROOTS });
}
