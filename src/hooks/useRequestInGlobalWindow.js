import { useEffect } from "react";
import { openRecordWindow } from "../utils/recordLink";

/**
 * A Purchase Request has ONE window: the one GlobalDetailManager owns (#850).
 * The Purchase Requests list and the Purchasing Dashboard used to mount their
 * own copy for `?request=`, so a notification clicked over the open request
 * opened a second window. Now `?request=` is rewritten to `?open=pr:<id>` (one
 * replace, so Back doesn't return to the old shape) and the global window opens
 * from that; the rewrite drops the `request` param itself.
 */
export function useRequestInGlobalWindow(recordId) {
  useEffect(() => {
    if (!recordId) return;
    openRecordWindow({ id: recordId, type: "PURCHASE_REQUEST", replace: true, dropParams: ["request"] });
  }, [recordId]);
}
