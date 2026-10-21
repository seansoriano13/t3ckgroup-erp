import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

/**
 * Meeting Requests are live (#627, docs/realtime-policy.md): both tables are in the
 * supabase_realtime publication and readable by every employee, so this listens with
 * `postgres_changes` and only uses the event as a nudge to refetch.
 *
 * Every Meeting Request query (the Calendar, My Meeting Requests, the form's Venue preview,
 * the Approval Center queue and its badge) keys under one of MEETING_QUERY_ROOTS, so one
 * invalidation per root refreshes all of them. One channel is shared by every screen mounted
 * at once and removed when the last one leaves.
 */
export const MEETING_TABLES = ["meeting_requests", "meeting_request_participants"];
export const MEETING_QUERY_ROOTS = [["calendar-entries"], ["meeting-requests"]];

let shared = null;

function join(listener) {
  if (!shared) {
    const listeners = new Set();
    let channel = supabase.channel("meeting-requests-changes");
    MEETING_TABLES.forEach((table) => {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        listeners.forEach((l) => l(payload));
      });
    });
    channel.subscribe();
    shared = { channel, listeners };
  }
  shared.listeners.add(listener);
  const own = shared;
  return () => {
    own.listeners.delete(listener);
    if (own.listeners.size > 0) return;
    if (shared === own) shared = null;
    supabase.removeChannel(own.channel);
  };
}

export function useMeetingRealtime() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      join(() => {
        MEETING_QUERY_ROOTS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      }),
    [queryClient],
  );
}
