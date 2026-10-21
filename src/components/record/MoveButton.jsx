// One move as both the card and the drawer's footer draw it: the button (green
// Approve, outline Prepare and Mark costs, pale red Return), its consequence
// hint, and, when it failed from here, the inline error. The card adds a
// "Review section" link, which opens the section in the drawer.

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { APPROVE_CLASS } from "@/components/ui/approveClass";
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
 * `onReview(section)` adds the link (the card only); `reviewText(section)` is
 * the link's words.
 */
/**
 * `compact` (the rail): a small full-width button; the hint stays for assistive
 * tech and the tooltip, the review link stays under it.
 */
export default function MoveButton({ move, origin, disabled = false, onRun, onReview, reviewText, failure, busy = false, compact = false }) {
  const { icon: Icon, label, hint, kind, key, warning } = move;
  const failed = failure && failure.key === key && failure.origin === origin ? failure : null;

  return (
    <li className={compact ? "space-y-1.5" : "space-y-2"}>
      {/* A long label wraps inside the button instead of running into its edges. On the
          card the button fits its label (the card spans the page); the drawer's footer fills its width. */}
      <Button
        size={compact ? "sm" : origin === "card" ? "default" : "lg"}
        title={compact ? hint : undefined}
        variant={LOOK[kind].variant}
        disabled={disabled}
        onClick={() => onRun(move, origin)}
        aria-describedby={`move-hint-${origin}-${key}`}
        className={cn(
          "h-auto min-h-10 w-full justify-center gap-2 px-4 py-2.5 text-center font-semibold leading-snug whitespace-normal",
          origin === "card" && !compact && "min-h-9 sm:w-auto sm:min-w-48 sm:max-w-full sm:py-2",
          compact && "min-h-8 py-1.5 text-[13px]",
          LOOK[kind].className,
        )}
      >
        <Icon size={16} aria-hidden="true" />
        <span className="min-w-0">{label}</span>
      </Button>
      {/* A warning beside the button (the IPAS's bill check): it says something is off, and never disables the move. */}
      {warning && (
        <p
          role="status"
          data-testid={`move-warning-${origin}-${key}`}
          className="max-w-prose rounded-lg bg-amber-a3 px-2.5 py-2 text-xs leading-relaxed font-semibold text-amber-11"
        >
          {warning}
        </p>
      )}
      {/* The hint takes the full width, with the review link on its own line under it. */}
      <div className="grid max-w-prose gap-1.5">
        <p id={`move-hint-${origin}-${key}`} className={cn("text-xs leading-relaxed text-muted-foreground", compact && "sr-only")}>
          {hint}
        </p>
        {onReview && move.section && (
          <Button
            variant="link"
            size="sm"
            className="h-auto justify-self-start p-0 text-xs font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
            onClick={() => onReview(move.section)}
          >
            {reviewText ? reviewText(move.section) : "Review section"}
          </Button>
        )}
      </div>
      {failed && (
        <InlineError message={failed.message} busy={busy} onRetry={failed.retry} onDismiss={failed.dismiss} />
      )}
    </li>
  );
}
