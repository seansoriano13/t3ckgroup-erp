import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * A failed move, said where it was started: under the card's move or in the
 * drawer's footer. `onRetry` runs the same mutation again; `onDismiss` clears
 * it. The page clears it too when that move succeeds. Alongside the toast, not
 * instead of it.
 */
export default function InlineError({ message, onRetry, onDismiss, busy = false }) {
  return (
    <div
      role="alert"
      className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-7 bg-red-2 px-3 py-2 text-sm text-red-11"
    >
      <CircleAlert size={14} aria-hidden="true" className="shrink-0" />
      <p className="min-w-0 flex-1">{message}</p>
      <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
        Retry
      </Button>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
