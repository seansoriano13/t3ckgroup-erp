import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Briefcase } from "lucide-react";
import { opportunityService } from "../../services/opportunityService";
import { Button } from "../ui/button";

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
    // Quick View, not the full modal — every entry point into an SOR
    // from a task lands there first, whatever the viewer's access level.
    window.dispatchEvent(
      new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: opportunityId, type: "OPPORTUNITY_QUICK_VIEW" } }),
    );
  };

  if (variant === "inline") {
    return (
      // Solid, so it reads as a button, but in the foreground ink rather than
      // primary red: this is navigation, and red belongs to the modal's real
      // actions (Rate, Delete) — ADR 0009. Verb up front, the reference as a
      // quieter tail after a divider.
      <Button
        type="button"
        size="lg"
        onClick={open}
        title={`Open SOR ${label}`}
        className="h-9 max-w-full gap-2 rounded-lg bg-foreground px-3.5 text-[13px] font-bold text-background shadow-md hover:bg-foreground/85"
      >
        <Briefcase size={15} />
        <span>Open SOR</span>
        <span aria-hidden className="h-4 w-px shrink-0 bg-background/35" />
        <span className="max-w-[200px] truncate font-semibold text-background/80">
          {label}
        </span>
        <ArrowUpRight size={15} className="transition-transform group-hover/button:translate-x-0.5 group-hover/button:-translate-y-0.5" />
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 pt-2">
      <span className="flex items-center gap-1.5 pl-1 text-label font-bold tracking-wider text-muted-foreground uppercase">
        <Briefcase size={12} /> Sales Opportunity
      </span>
      <Button
        type="button"
        variant="ghost"
        onClick={open}
        className="h-auto justify-between gap-2 rounded-xl border border-border/50 bg-muted px-4 py-3 text-left text-sm font-bold text-foreground shadow-sm hover:bg-muted/70"
      >
        <span className="flex items-center gap-2">
          <Briefcase size={14} />
          {label}
        </span>
        <ArrowUpRight size={14} className="text-muted-foreground" />
      </Button>
    </div>
  );
}
