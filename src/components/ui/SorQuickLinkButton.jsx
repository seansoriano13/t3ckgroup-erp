import { Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The TaskCard footer's SOR indicator (#316) — icon only, no Sales
 * Reference: that number is already the task-title standard for a
 * Stage-Action task, so repeating it here would be the same value twice on
 * one card. Opens Quick View, the shared landing spot for every
 * task-originated link into an SOR.
 */
export function SorQuickLinkButton({ opportunityId, className = "" }) {
  if (!opportunityId) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("OPEN_ENTITY_DETAILS", {
            detail: { id: opportunityId, type: "OPPORTUNITY_QUICK_VIEW" },
          }),
        );
      }}
      title="Linked Sales Opportunity"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-mauve-4 text-mauve-11 ring-1 ring-mauve-6 transition-colors hover:bg-mauve-5 hover:ring-mauve-8",
        className,
      )}
    >
      <Briefcase size={12} strokeWidth={2.5} />
    </button>
  );
}
