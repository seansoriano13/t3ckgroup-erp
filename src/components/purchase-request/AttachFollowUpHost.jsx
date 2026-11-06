import { useEffect, useSyncExternalStore } from "react";

import { AttachToOthers } from "./AttachToOthers";
import { clearAttachFollowUp, getStep, registerHost, subscribe } from "./attachFollowUp";

/**
 * The "attach to other items" step that follows an Attach P0, kept above the item rows. Attaching changes the line
 * (its status, and whether it folds into "N done"), so its row can re-render or leave the list while the step is
 * still open, and a step held by the row's own dialog then vanishes the moment it appears. The step lives here
 * instead, in the one host the Requested Items list mounts (state in ./attachFollowUp).
 */
export default function AttachFollowUpHost({ requestId }) {
  const step = useSyncExternalStore(subscribe, getStep);

  useEffect(() => registerHost(), []);

  if (!step || step.requestId !== requestId) return null;
  return (
    <AttachToOthers
      open
      onClose={clearAttachFollowUp}
      requestId={requestId}
      poNumber={step.poNumber}
      offer={step.offer}
      orderEarly={step.orderEarly}
      earlyReason={step.earlyReason}
    />
  );
}
