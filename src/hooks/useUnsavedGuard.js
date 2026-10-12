import { useEffect } from "react";
import { useBlocker } from "react-router";

export const UNSAVED_MESSAGE = "You have unsaved changes. Leave this page and discard them?";

/**
 * Warn before unsaved edits are lost: a confirm on in-app navigation (router
 * blocker) and the browser's own prompt on close / reload. Does nothing while
 * `hasChanges` is false.
 */
export function useUnsavedGuard(hasChanges) {
  const blocker = useBlocker(hasChanges);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(UNSAVED_MESSAGE)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  useEffect(() => {
    if (!hasChanges) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasChanges]);
}
