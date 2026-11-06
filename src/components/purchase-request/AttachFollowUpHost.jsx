import { useEffect, useSyncExternalStore } from "react";

import { AttachToOthers } from "./AttachToOthers";

/**
 * The "attach to other items" step that follows an Attach P0 (#809, #811), kept above the item rows. Attaching changes
 * the line (its status, and whether it folds into "N done"), so its row can re-render or leave the list while the
 * step is still open, and a step held by the row's own dialog then vanishes the moment it appears. The step lives here
 * instead, in the one host the Requested Items list mounts, and survives whatever the row does.
 */

let current = null;
let hosts = 0;
const listeners = new Set();

const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Opens the step. Returns false when no host is mounted, so the caller keeps the step in its own dialog. */
export function showAttachFollowUp(step) {
  if (hosts === 0) return false;
  current = step;
  emit();
  return true;
}

function clear() {
  current = null;
  emit();
}

/** Mounted once by the Requested Items list of `requestId`. */
export default function AttachFollowUpHost({ requestId }) {
  const step = useSyncExternalStore(subscribe, () => current);

  useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
      if (hosts === 0 && current) clear();
    };
  }, []);

  if (!step || step.requestId !== requestId) return null;
  return (
    <AttachToOthers
      open
      onClose={clear}
      requestId={requestId}
      poNumber={step.poNumber}
      offer={step.offer}
      orderEarly={step.orderEarly}
      earlyReason={step.earlyReason}
    />
  );
}
