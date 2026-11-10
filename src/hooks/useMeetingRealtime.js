import { useTableRealtime } from "./useTableRealtime";

/**
 * Meeting Requests are live (#627, docs/realtime-policy.md): both tables broadcast a change
 * signal from a trigger, and `useTableRealtime` turns it into a refetch.
 *
 * Every Meeting Request query (the Calendar, My Meeting Requests, the form's Venue preview,
 * the Approval Center queue and its badge) keys under one of MEETING_QUERY_ROOTS, so one
 * invalidation per root refreshes all of them. The shared hook keeps one channel per table
 * across every screen mounted at once.
 */
export const MEETING_TABLES = ["meeting_requests", "meeting_request_participants"];
export const MEETING_QUERY_ROOTS = [["calendar-entries"], ["meeting-requests"]];

export function useMeetingRealtime() {
  useTableRealtime(MEETING_TABLES[0], { invalidateKeys: MEETING_QUERY_ROOTS });
  useTableRealtime(MEETING_TABLES[1], { invalidateKeys: MEETING_QUERY_ROOTS });
}
