import { ArrowUpRight, Briefcase } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requestKind, REQUEST_KIND } from "@/constants/purchaseRequest";

/**
 * Header pill that jumps from a Purchase Request to the SOR it was raised for.
 * Same look as SorLink's inline button; Quick View is the landing spot, as for
 * every other link into an SOR. Direct requests have no SOR, so nothing shows.
 *
 * `onBeforeOpen` runs first (the modal closes itself so Quick View isn't
 * stacked under it); the drawer leaves it off and stays open behind.
 */
export default function OpenSorButton({ request, compact = false, onBeforeOpen }) {
  if (!request || requestKind(request) !== REQUEST_KIND.PROJECT) return null;
  const ref = request.sales_reference;

  const open = () => {
    onBeforeOpen?.();
    window.dispatchEvent(
      new CustomEvent("OPEN_ENTITY_DETAILS", {
        detail: { id: request.opportunity_id, type: "OPPORTUNITY_QUICK_VIEW" },
      }),
    );
  };

  return (
    <Button
      type="button"
      size="lg"
      onClick={open}
      title={ref ? `Open SOR ${ref}` : "Open SOR"}
      className="h-8 shrink-0 gap-1.5 rounded-lg bg-foreground px-3 text-xs font-bold text-background shadow-sm hover:bg-foreground/85"
    >
      <Briefcase size={14} />
      <span>{compact ? "SOR" : "Open SOR"}</span>
      {!compact && ref && (
        <>
          <span aria-hidden className="h-3.5 w-px shrink-0 bg-background/35" />
          <span className="max-w-[140px] truncate font-semibold text-background/80">{ref}</span>
        </>
      )}
      <ArrowUpRight size={14} />
    </Button>
  );
}
