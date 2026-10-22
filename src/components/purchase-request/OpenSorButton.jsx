import { ArrowUpRight, Briefcase } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requestKind, REQUEST_KIND } from "@/constants/purchaseRequest";

/**
 * Outline button, top right of the record window, that jumps from a Purchase Request to the SOR it was raised for.
 * Quick View is the landing spot, as for
 * every other link into an SOR. Direct requests have no SOR, so nothing shows.
 *
 * `onBeforeOpen` runs first (the modal closes itself so Quick View isn't
 * stacked under it).
 */
export default function OpenSorButton({ request, onBeforeOpen }) {
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
    <Button type="button" variant="outline" size="sm" onClick={open} title={ref ? `Open SOR ${ref}` : "Open SOR"} className="gap-1.5">
      <Briefcase size={14} />
      Open SOR
      <ArrowUpRight size={14} />
    </Button>
  );
}
