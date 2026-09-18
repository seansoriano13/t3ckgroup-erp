import { useQuery } from "@tanstack/react-query";
import { Briefcase } from "lucide-react";
import { opportunityService } from "../../services/opportunityService";

/**
 * The link from a task back to the SOR it was created for (issue #199), shared
 * by the individual task modal and the Group Task modal. It resolves its own
 * label from the SOR id, so it shows the same however the task was loaded —
 * a list read that doesn't embed the SOR, a by-id read that does.
 *
 * `onClose` runs before the open event: GlobalDetailManager's close clears
 * the active item, and in one batched update the later write wins, so this
 * order lands on the SOR instead of on nothing.
 */
export default function SorLink({ opportunityId, onClose, variant = "block" }) {
  const { data: label } = useQuery({
    queryKey: ["sorLinkLabel", opportunityId],
    queryFn: () => opportunityService.getOpportunityLinkLabel(opportunityId),
    enabled: Boolean(opportunityId),
    staleTime: 5 * 60 * 1000,
  });

  if (!opportunityId || !label) return null;

  const open = () => {
    onClose?.();
    window.dispatchEvent(
      new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: opportunityId, type: "OPPORTUNITY" } }),
    );
  };

  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={open}
        className="ml-2 flex items-center gap-1.5 transition-colors hover:text-foreground"
      >
        <Briefcase size={14} className="text-muted-foreground" />
        <span className="max-w-[200px] truncate" title={label}>
          Deal: {label}
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 pt-2">
      <span className="flex items-center gap-1.5 pl-1 text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
        <Briefcase size={12} /> Sales Opportunity
      </span>
      <button
        type="button"
        onClick={open}
        className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted px-4 py-3 text-left text-sm font-bold text-foreground shadow-sm transition-colors hover:bg-muted/70"
      >
        <Briefcase size={14} />
        {label}
      </button>
    </div>
  );
}
