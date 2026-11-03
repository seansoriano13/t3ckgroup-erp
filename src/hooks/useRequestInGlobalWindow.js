import { useEffect } from "react";

/**
 * A Purchase Request has ONE window: the one GlobalDetailManager owns (#850).
 * The Purchase Requests list and the Purchasing Dashboard used to mount their
 * own copy for `?request=`, so a notification clicked over the open request
 * opened a second window. Now `?request=` just hands the id to the global one
 * and clears itself.
 */
export function useRequestInGlobalWindow(recordId, close) {
  useEffect(() => {
    if (!recordId) return;
    window.dispatchEvent(
      new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: recordId, type: "PURCHASE_REQUEST" } }),
    );
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per id
  }, [recordId]);
}
