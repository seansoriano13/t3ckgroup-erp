import { cn } from "@/lib/utils";
import { MIN_CANVASS_OFFERS } from "../constants/canvass";

/**
 * A Canvass's offers side by side: always three columns (one under another on a phone), every
 * Canvass view the same. Columns not yet filled (`filled` counts the children that take one)
 * show as empty "Offer n" slots, so a Canvass with one offer, or none yet, still reads as the
 * three-way comparison it is meant to be.
 */
export default function CanvassOffersGrid({ filled, children, className = "", ...props }) {
  const empty = Math.max(0, MIN_CANVASS_OFFERS - filled);
  return (
    <div className={cn("grid grid-cols-1 gap-3 md:grid-cols-3", className)} {...props}>
      {children}
      {Array.from({ length: empty }, (_, i) => (
        <div
          key={`empty-${i}`}
          data-testid="offer-slot-empty"
          className="flex min-h-16 items-center justify-center rounded-xl border border-dashed border-border/70 px-3 py-2 text-[12px] text-muted-foreground"
        >
          Offer {filled + i + 1} · not added yet
        </div>
      ))}
    </div>
  );
}
