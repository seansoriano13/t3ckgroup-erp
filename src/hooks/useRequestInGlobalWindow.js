import { useEffect } from "react";

/**
 * A Purchase Request has ONE window: the one GlobalDetailManager owns (#850).
 * The Purchase Requests list and the Purchasing Dashboard used to mount their
 * own copy for `?request=`, so a notification clicked over the open request
 * opened a second window. Now `?request=` is rewritten to `?open=pr:<id>` (one
 * replace, so Back doesn't return to the old shape) and the global window opens
 * from that. `close` is kept for callers; the rewrite drops the param itself.
 */
// eslint-disable-next-line no-unused-vars -- kept so existing callers stay unchanged
export function useRequestInGlobalWindow(recordId, close) {
  useEffect(() => {
    if (!recordId) return;
    window.dispatchEvent(
      new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: recordId, type: "PURCHASE_REQUEST", replace: true, dropParams: ["request"] } }),
    );
  }, [recordId]);
}
