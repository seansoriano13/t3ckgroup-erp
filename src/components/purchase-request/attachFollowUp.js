/**
 * The store behind AttachFollowUpHost: the step that follows an Attach P0 (#809, #811), held outside any item row so
 * it survives the row changing after the attach. The host registers itself while mounted; with none mounted, `show`
 * says no and the caller keeps the step in its own dialog.
 */

let current = null;
let hosts = 0;
const listeners = new Set();

const emit = () => listeners.forEach((listener) => listener());

export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getStep = () => current;

/** Opens the step. Returns false when no host is mounted. */
export function showAttachFollowUp(step) {
  if (hosts === 0) return false;
  current = step;
  emit();
  return true;
}

export function clearAttachFollowUp() {
  current = null;
  emit();
}

/** Called by the host on mount; returns its unmount cleanup. */
export function registerHost() {
  hosts += 1;
  return () => {
    hosts -= 1;
    if (hosts === 0 && current) clearAttachFollowUp();
  };
}
