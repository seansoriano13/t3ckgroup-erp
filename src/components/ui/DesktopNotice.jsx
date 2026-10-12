import { Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Best on desktop" notice for admin and config surfaces that are not built
 * for a phone (settings HR, flow canvas, release-notes demos). Shown below
 * the `md` breakpoint only; the page itself stays reachable.
 */
export default function DesktopNotice({ children = "This page is best on desktop.", className }) {
  return (
    <div
      role="note"
      data-testid="desktop-notice"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground md:hidden",
        className,
      )}
    >
      <Monitor className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
