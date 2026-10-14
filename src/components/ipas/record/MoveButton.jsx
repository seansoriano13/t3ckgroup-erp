// One move as both the card and the drawer's footer draw it: the button (green
// Approve, outline Prepare and Mark costs, pale red Send back), its consequence
// hint, and, when it failed from here, the inline error. The card adds a
// "Review section" link, which opens the section in the drawer.

import { Button } from "@/components/ui/button";
import { ipasSectionLabel } from "@/constants/ipas";
import { cn } from "@/lib/utils";
import { APPROVE_CLASS } from "@/constants/approveClass";
import InlineError from "./InlineError";

const LOOK = {
  approve: { variant: "default", className: APPROVE_CLASS },
  prepare: { variant: "outline", className: "" },
  neutral: { variant: "outline", className: "" },
  return: { variant: "destructive", className: "" },
};

/**
 * `origin` names where the move is drawn ("card" or "drawer"); a failure
 * carries the same origin, so only the copy at that place shows it.
 * `onReview(section)` adds the link (the card only).
 */
export default function MoveButton({ move, origin, disabled = false, onRun, onReview, failure, busy = false }) {
  const { icon: Icon, label, hint, kind, key } = move;
  const failed = failure && failure.key === key && failure.origin === origin ? failure : null;

  return (
    <li className="space-y-2">
      {/* A long label wraps inside the button instead of running into its edges. */}
      <Button
        size="lg"
        variant={LOOK[kind].variant}
        disabled={disabled}
        onClick={() => onRun(move, origin)}
        aria-describedby={`move-hint-${origin}-${key}`}
        className={cn(
          "h-auto min-h-10 w-full justify-center gap-2 px-4 py-2.5 text-center font-semibold leading-snug whitespace-normal",
          LOOK[kind].className,
        )}
      >
        <Icon size={16} aria-hidden="true" />
        <span className="min-w-0">{label}</span>
      </Button>
      {/* The hint takes the full width, with the review link on its own line under it. */}
      <div className="grid gap-1.5">
        <p id={`move-hint-${origin}-${key}`} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
        {onReview && (
          <Button
            variant="link"
            size="sm"
            className="h-auto justify-self-start p-0 text-xs font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
            onClick={() => onReview(move.section)}
          >
            Review section {ipasSectionLabel(move.section)}
          </Button>
        )}
      </div>
      {failed && (
        <InlineError message={failed.message} busy={busy} onRetry={failed.retry} onDismiss={failed.dismiss} />
      )}
    </li>
  );
}
