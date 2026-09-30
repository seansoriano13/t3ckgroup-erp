import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

const PARAM = "record";

/**
 * The open record of a slide-over, kept in the URL (`?record=`) so a refresh
 * or a shared link reopens it. Opening adds a history entry; stepping to a
 * neighbour and closing replace it, so Back leaves the slide-over rather than
 * replaying every record visited. Other query params are left alone.
 *
 * The router commits URL changes as a low-priority transition, so a change
 * is also held locally until the URL catches up: without that, a query
 * refetch landing first (the decided record leaves its queue) would render
 * the slide-over shut for a beat before it moved to the next record.
 */
export function useRecordParam() {
  const [params, setParams] = useSearchParams();
  const urlId = params.get(PARAM);
  const [held, setHeld] = useState(null);

  useEffect(() => setHeld(null), [urlId]);

  const setRecord = useCallback(
    (id, { replace = false } = {}) => {
      const next = id == null ? null : String(id);
      setHeld((cur) => (next === urlId && !cur ? cur : { id: next }));
      setParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          if (next == null) nextParams.delete(PARAM);
          else nextParams.set(PARAM, next);
          return nextParams;
        },
        { replace },
      );
    },
    [setParams, urlId],
  );

  const open = useCallback((id) => setRecord(id), [setRecord]);
  const step = useCallback((id) => setRecord(id, { replace: true }), [setRecord]);
  const close = useCallback(() => setRecord(null, { replace: true }), [setRecord]);

  return { recordId: held ? held.id : urlId, open, step, close };
}
