import { cn } from "@/lib/utils"

// A link that leaves the app. Always opens in a new tab and never hands the
// opened page a reference back to this one (noopener) or our URL (noreferrer).
function ExternalLink({ className, children, ...props }) {
  return (
    <a
      data-slot="external-link"
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "underline underline-offset-2 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
      {...props}>
      {children}
    </a>
  );
}

export { ExternalLink }
