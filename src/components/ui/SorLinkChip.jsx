import { Briefcase } from "lucide-react";

/**
 * The pill every task row (individual or group) shows when it is linked to
 * an SOR — Sales Reference when the deal has one, Company otherwise. Clicking
 * it opens the SOR the same way everywhere: the global entity-details event.
 */
export function SorLinkChip({ opportunityId, opportunity, className = "" }) {
  if (!opportunityId || !opportunity) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("OPEN_ENTITY_DETAILS", {
            detail: { id: opportunityId, type: "OPPORTUNITY" },
          }),
        );
      }}
      title={`Linked to deal: ${opportunity.client_name}`}
      className={`flex min-w-0 shrink items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary transition-colors hover:bg-primary/20 ${className}`}
    >
      <Briefcase size={10} className="shrink-0" />
      <span className="truncate">{opportunity.sales_reference || opportunity.client_name}</span>
    </button>
  );
}
